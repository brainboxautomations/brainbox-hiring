import { NextResponse, type NextRequest } from "next/server";

import {
  createSupabaseServiceClient,
  MissingServiceRoleKeyError,
} from "@/configurations/supabase-service-configuration";
import { apiError, apiUnexpected } from "@/app/api/_helpers";
import { guardPublicSubmission } from "@/app/api/_public-intake";
import { applyPayloadSchema } from "@/schemas/apply-schema";
import { parseVideoLink } from "@/utilities/video-link";
import { isApplicationStoragePath, MAX_APPLY_REQUEST_BYTES } from "@/utilities/candidate-uploads";
import type { Json } from "@/types/database.types";

export const runtime = "nodejs";

type DocumentKind = "resume" | "video" | "other";

export async function POST(request: NextRequest) {
  // The intake functions are callable only by the service role (migration
  // 0049), so the captcha and rate limits below cannot be gone around.
  let supabase;
  try {
    supabase = createSupabaseServiceClient();
  } catch (error) {
    if (error instanceof MissingServiceRoleKeyError) {
      return apiError("Applications are not being accepted right now.", 503);
    }
    throw error;
  }

  const contentLength = Number(request.headers.get("content-length") ?? "0");
  if (contentLength > MAX_APPLY_REQUEST_BYTES) {
    return apiError("That upload is too large. Please use a smaller file.", 413);
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return apiError("Could not read the upload — check your file size and try again.");
  }

  const rawPayload = form.get("payload");
  if (typeof rawPayload !== "string") {
    return apiError("Missing payload");
  }

  let json: unknown;
  try {
    json = JSON.parse(rawPayload);
  } catch {
    return apiError("Invalid payload JSON");
  }

  const parsed = applyPayloadSchema.safeParse(json);
  if (!parsed.success) {
    return apiError(parsed.error.issues[0]?.message ?? "Invalid application", 422);
  }
  const payload = parsed.data;

  const captchaToken = form.get("captchaToken");
  const refused = await guardPublicSubmission(supabase, request, {
    kind: "apply",
    captchaToken: typeof captchaToken === "string" ? captchaToken : null,
    email: payload.email,
  });
  if (refused) return refused;

  try {
    const { data: acceptsApplications, error: posError } = await supabase.rpc(
      "public_position_is_open",
      { p_position_id: payload.positionId },
    );
    if (posError) return apiError(posError.message, 500);
    if (!acceptsApplications) {
      return apiError("This position is not accepting applications", 404);
    }

    const documents: Array<{
      kind: DocumentKind;
      storagePath: string;
      filename: string | null;
      mimeType: string | null;
    }> = [];

    const fileAnswers: Array<{ questionId: string; value: Json }> = [];

    // The browser has already put every file in Storage; only paths come here.
    // Files used to travel in this request, and the host rejects bodies over
    // ~6 MB before this route runs. A path is client-supplied, so it must name
    // this position's folder — the same check video answers get below.
    for (const upload of payload.uploads) {
      if (!isApplicationStoragePath(upload.storagePath, payload.positionId)) {
        return apiError("Invalid upload path", 422);
      }

      const file = {
        storagePath: upload.storagePath,
        filename: upload.filename ?? null,
        mimeType: upload.mimeType ?? null,
      };

      documents.push({ kind: upload.slot === "resume" ? "resume" : "other", ...file });
      if (upload.slot === "question") {
        fileAnswers.push({ questionId: upload.questionId, value: { source: "upload", ...file } });
      }
    }

    const videoAnswerValues: Array<{ questionId: string; value: Json }> = [];

    for (const answer of payload.videoAnswers) {
      if (answer.source === "upload") {
        if (!isApplicationStoragePath(answer.storagePath, payload.positionId)) {
          return apiError("Invalid video upload path", 422);
        }
        documents.push({
          kind: "video",
          storagePath: answer.storagePath,
          filename: answer.filename ?? null,
          mimeType: answer.mimeType ?? null,
        });
        videoAnswerValues.push({
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

      const parsed = parseVideoLink(answer.url);
      if (!parsed) {
        return apiError(
          "Video links must be an https Loom, Google Drive, YouTube, or Vimeo URL",
          422,
        );
      }

      videoAnswerValues.push({
        questionId: answer.questionId,
        value: {
          source: "link",
          provider: parsed.provider,
          url: parsed.watchUrl,
          embedUrl: parsed.embedUrl,
        },
      });
    }

    const { data: result, error: rpcError } = await supabase.rpc("submit_application", {
      payload: {
        positionId: payload.positionId,
        firstName: payload.firstName,
        lastName: payload.lastName ?? null,
        email: payload.email,
        phone: payload.phone ?? null,
        formAnswers: payload.formAnswers,
        questionnaireAnswers: [
          ...payload.questionnaireTextAnswers,
          ...fileAnswers,
          ...videoAnswerValues,
        ],
        documents,
      },
    });
    if (rpcError) return apiError(rpcError.message, 500);

    const applicationId = (result as { applicationId?: string } | null)?.applicationId ?? null;
    return NextResponse.json({ applicationId }, { status: 201 });
  } catch (error) {
    return apiUnexpected(error);
  }
}
