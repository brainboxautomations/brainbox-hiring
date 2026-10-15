import { NextResponse, type NextRequest } from "next/server";

import {
  createSupabaseServiceClient,
  MissingServiceRoleKeyError,
} from "@/configurations/supabase-service-configuration";
import { apiError, apiUnexpected } from "@/app/api/_helpers";
import { putObject } from "@/configurations/object-storage";
import { guardPublicSubmission } from "@/app/api/_public-intake";
import { questionnaireSubmissionSchema } from "@/schemas/questionnaire-submission-schema";
import { isQuestionnaireTokenShape } from "@/utilities/questionnaire-token";
import { parseVideoLink } from "@/utilities/video-link";
import {
  applicationStoragePath,
  isApplicationStoragePath,
  MAX_RESUME_BYTES,
} from "@/utilities/candidate-uploads";
import type { Json } from "@/types/database.types";

export const runtime = "nodejs";

export const LINK_NOT_VALID = "This questionnaire link is no longer valid";

type SubmittedAnswer = { questionId: string; value: Json };

export async function POST(request: NextRequest) {
  // Submitting and uploading are server-only since migration 0049, so the
  // captcha and rate limit below are the only way in.
  let supabase;
  try {
    supabase = createSupabaseServiceClient();
  } catch (error) {
    if (error instanceof MissingServiceRoleKeyError) {
      return apiError("Questionnaires can't be submitted right now.", 503);
    }
    throw error;
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return apiError("Expected multipart/form-data");
  }

  const rawPayload = form.get("payload");
  if (typeof rawPayload !== "string") return apiError("Missing payload");

  let json: unknown;
  try {
    json = JSON.parse(rawPayload);
  } catch {
    return apiError("Invalid payload JSON");
  }

  const parsed = questionnaireSubmissionSchema.safeParse(json);
  if (!parsed.success) {
    return apiError(parsed.error.issues[0]?.message ?? "Invalid submission", 422);
  }
  const payload = parsed.data;

  if (!isQuestionnaireTokenShape(payload.token)) return apiError(LINK_NOT_VALID, 410);

  const captchaToken = form.get("captchaToken");
  const refused = await guardPublicSubmission(supabase, request, {
    kind: "questionnaire",
    captchaToken: typeof captchaToken === "string" ? captchaToken : null,
  });
  if (refused) return refused;

  try {
    const { data: resolved, error: resolveError } = await supabase
      .rpc("public_questionnaire_by_token", { p_token: payload.token })
      .maybeSingle();

    if (resolveError) return apiError(resolveError.message, 500);
    if (!resolved) return apiError(LINK_NOT_VALID, 410);

    const positionId = resolved.position_id;
    const answers: SubmittedAnswer[] = [...payload.textAnswers];

    for (const upload of payload.uploads) {
      const file = form.get(upload.fileKey);
      if (!(file instanceof File) || file.size === 0) continue;

      if (file.size > MAX_RESUME_BYTES) {
        return apiError(`"${file.name}" is too large`, 413);
      }

      const path = applicationStoragePath(positionId, file.name);
      try {
        await putObject(
          "resumes",
          path,
          new Uint8Array(await file.arrayBuffer()),
          file.type || "application/octet-stream",
        );
      } catch (error) {
        const reason = error instanceof Error ? error.message : "storage unavailable";
        return apiError(`Upload failed: ${reason}`, 500);
      }

      answers.push({
        questionId: upload.questionId,
        value: {
          source: "upload",
          storagePath: path,
          filename: file.name || null,
          mimeType: file.type || null,
        },
      });
    }

    for (const answer of payload.videoAnswers) {
      if (answer.source === "upload") {
        if (!isApplicationStoragePath(answer.storagePath, positionId)) {
          return apiError("Invalid video upload path", 422);
        }
        answers.push({
          questionId: answer.questionId,
          value: {
            source: "upload",
            storagePath: answer.storagePath,
            filename: answer.filename ?? null,
            mimeType: answer.mimeType ?? null,
          },
        });
        continue;
      }

      const link = parseVideoLink(answer.url);
      if (!link) {
        return apiError(
          "Video links must be an https Loom, Google Drive, YouTube, or Vimeo URL",
          422,
        );
      }

      answers.push({
        questionId: answer.questionId,
        value: {
          source: "link",
          provider: link.provider,
          url: link.watchUrl,
          embedUrl: link.embedUrl,
        },
      });
    }

    const { error: submitError } = await supabase.rpc("submit_questionnaire_response", {
      p_token: payload.token,
      p_answers: answers as unknown as Json,
    });

    if (submitError) {
      const rejectedTheLink = submitError.message.includes("questionnaire link");
      return rejectedTheLink ? apiError(LINK_NOT_VALID, 410) : apiError(submitError.message, 500);
    }

    return NextResponse.json({ completed: true });
  } catch (error) {
    return apiUnexpected(error);
  }
}
