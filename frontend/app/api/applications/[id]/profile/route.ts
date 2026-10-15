import { NextResponse, type NextRequest } from "next/server";

import { apiError, apiUnexpected, requireUser } from "@/app/api/_helpers";
import {
  mapAnswer,
  mapDocument,
  mapPipelineStage,
  mapResponse,
  mapUpcomingAutomation,
  normalizeLinks,
  normalizeStringMap,
} from "@/app/api/_mappers";
import type { AnswerMedia, CandidateProfile, ProfileApplicationSummary } from "@/types/api";
import { signDownload } from "@/configurations/object-storage";
import { parseVideoLink } from "@/utilities/video-link";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string }> };

function bucketFor(kind: "resume" | "video" | "other"): "resumes" | "videos" {
  return kind === "video" ? "videos" : "resumes";
}

/** A one-hour link to the file, or null when one cannot be made. */
async function signUrl(bucket: "resumes" | "videos", path: string): Promise<string | null> {
  try {
    return await signDownload(bucket, path);
  } catch {
    return null;
  }
}

async function resolveAnswerMedia(
  type: "file" | "video",
  value: unknown,
): Promise<AnswerMedia | null> {
  const bucket = type === "video" ? "videos" : "resumes";

  if (typeof value === "string") {
    if (!value) return null;
    return {
      source: "upload",
      url: await signUrl(bucket, value),
      embedUrl: null,
      provider: null,
      filename: null,
      mimeType: null,
    };
  }

  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;

  if (record.source === "upload" && typeof record.storagePath === "string") {
    return {
      source: "upload",
      url: await signUrl(bucket, record.storagePath),
      embedUrl: null,
      provider: null,
      filename: typeof record.filename === "string" ? record.filename : null,
      mimeType: typeof record.mimeType === "string" ? record.mimeType : null,
    };
  }

  if (record.source === "link" && typeof record.url === "string") {
    const parsed = parseVideoLink(record.url);
    if (!parsed) return null;
    return {
      source: "link",
      url: parsed.watchUrl,
      embedUrl: parsed.embedUrl,
      provider: parsed.provider,
      filename: null,
      mimeType: null,
    };
  }

  return null;
}

export async function GET(_request: NextRequest, { params }: RouteContext) {
  const ctx = await requireUser();
  if (ctx instanceof NextResponse) return ctx;
  const { supabase } = ctx;
  const { id } = await params;

  try {
    const { data: app, error: appErr } = await supabase
      .from("applications")
      .select(
        "id, position_id, person_id, current_stage_id, starred, seen, status, applied_at, application_form_answers, people(id, first_name, last_name, email, phone, headline, links, custom_attributes), positions(title, position_stages(id, name, sort_order))",
      )
      .eq("id", id)
      .maybeSingle();
    if (appErr) return apiError(appErr.message, 500);
    if (!app) return apiError("Candidate not found", 404);

    const person = app.people;
    if (!person) return apiError("Candidate record is missing its person", 500);

    const stages = (app.positions?.position_stages ?? [])
      .slice()
      .sort((s1, s2) => s1.sort_order - s2.sort_order)
      .map(mapPipelineStage);

    const { data: apps, error: appsErr } = await supabase
      .from("applications")
      .select("id, position_id, status, positions(title), position_stages(name)")
      .eq("person_id", app.person_id)
      .order("applied_at", { ascending: false });
    if (appsErr) return apiError(appsErr.message, 500);

    const applications: ProfileApplicationSummary[] = (apps ?? []).map((row) => ({
      applicationId: row.id,
      positionId: row.position_id,
      positionTitle: row.positions?.title ?? "Untitled position",
      stageName: row.position_stages?.name ?? null,
      archived: row.status === "archived",
    }));

    const { data: docRows, error: docErr } = await supabase
      .from("documents")
      .select("id, kind, filename, mime_type, storage_path, created_at")
      .eq("person_id", app.person_id)
      .order("created_at", { ascending: false });
    if (docErr) return apiError(docErr.message, 500);

    const documents = await Promise.all(
      (docRows ?? []).map(async (row) => {
        const url = await signUrl(bucketFor(row.kind), row.storage_path);
        return mapDocument(row, url);
      }),
    );

    const { data: respRows, error: respErr } = await supabase
      .from("questionnaire_responses")
      .select(
        "id, context, status, sent_at, completed_at, reminders_stopped_at, access_token_expires_at, questionnaire_templates(name, questions(count)), scheduled_actions(kind, status), answers(question_id, value, questions(type, prompt))",
      )
      .eq("application_id", id)
      .order("created_at", { ascending: false });
    if (respErr) return apiError(respErr.message, 500);

    const questionnaires = await Promise.all(
      (respRows ?? []).map(async (resp) => {
        const answers = await Promise.all(
          (resp.answers ?? []).map(async (ans) => {
            const type = ans.questions?.type;
            const media =
              type === "file" || type === "video"
                ? await resolveAnswerMedia(type, ans.value)
                : null;
            return mapAnswer(ans, media);
          }),
        );
        return mapResponse(resp, answers);
      }),
    );

    const { data: resubmissionRows, error: resubmissionErr } = await supabase
      .from("application_resubmission_attempts")
      .select("attempted_at")
      .eq("application_id", id)
      .order("attempted_at", { ascending: false });
    if (resubmissionErr) return apiError(resubmissionErr.message, 500);

    const resubmissionAttempts = {
      count: resubmissionRows?.length ?? 0,
      mostRecentAt: resubmissionRows?.[0]?.attempted_at ?? null,
    };

    const { data: upcomingRows, error: upcomingErr } = await supabase
      .from("scheduled_actions")
      .select(
        "id, kind, scheduled_for, reminder_number, origin_stage:position_stages!scheduled_actions_origin_stage_id_fkey(name), stage_actions(type, message_templates(name), questionnaire_templates(name), target_stage:position_stages!stage_actions_target_position_stage_id_fkey(name)), questionnaire_responses(questionnaire_templates(name))",
      )
      .eq("application_id", id)
      .eq("status", "pending")
      .in("kind", ["stage_action", "reminder"])
      .order("scheduled_for", { ascending: true });
    if (upcomingErr) return apiError(upcomingErr.message, 500);

    const profile: CandidateProfile = {
      application: {
        id: app.id,
        positionId: app.position_id,
        positionTitle: app.positions?.title ?? "Untitled position",
        stageId: app.current_stage_id,
        starred: app.starred,
        seen: app.seen,
        archived: app.status === "archived",
        appliedAt: app.applied_at,
        formAnswers: normalizeStringMap(app.application_form_answers),
        resubmissionAttempts,
      },
      person: {
        id: person.id,
        firstName: person.first_name,
        lastName: person.last_name,
        email: person.email,
        phone: person.phone,
        headline: person.headline,
        links: normalizeLinks(person.links),
        customAttributes: normalizeStringMap(person.custom_attributes),
      },
      stages,
      applications,
      documents,
      questionnaires,
      upcomingAutomations: (upcomingRows ?? []).map(mapUpcomingAutomation),
    };

    return NextResponse.json({ profile });
  } catch (error) {
    return apiUnexpected(error);
  }
}
