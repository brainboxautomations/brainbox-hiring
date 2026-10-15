import { NextResponse, type NextRequest } from "next/server";

import { apiError, apiUnexpected } from "@/app/api/_helpers";
import { guardPublicSubmission } from "@/app/api/_public-intake";
import {
  createSupabaseServiceClient,
  MissingServiceRoleKeyError,
} from "@/configurations/supabase-service-configuration";
import { MissingObjectStorageError, signUpload } from "@/configurations/object-storage";
import { publicUploadRequestSchema, type PublicUploadTicket } from "@/schemas/public-upload-schema";
import {
  applicationStoragePath,
  candidateUploadError,
  uploadContentType,
} from "@/utilities/candidate-uploads";
import { isQuestionnaireTokenShape } from "@/utilities/questionnaire-token";

export const runtime = "nodejs";

export const NOT_ACCEPTING_UPLOADS = "This form isn't accepting files right now.";

/**
 * Issues a one-time upload URL for a file on the apply form or the hosted
 * questionnaire.
 *
 * Signed-out visitors used to upload straight into Storage under an anon
 * policy, which anyone holding the public key could use without ever opening a
 * form. Now the server decides: the position must be accepting applications (or
 * the questionnaire link must be live), the caller must be under the upload
 * rate limit, and the server picks the object path. The browser then PUTs the
 * bytes straight to storage (Cloudflare R2) with the returned URL, so large
 * files never pass through this app. The size and type limits are checked here
 * and signed into that URL, since R2 has no per-folder limits of its own.
 */
export async function POST(request: NextRequest) {
  let supabase;
  try {
    supabase = createSupabaseServiceClient();
  } catch (error) {
    if (error instanceof MissingServiceRoleKeyError) return apiError(NOT_ACCEPTING_UPLOADS, 503);
    throw error;
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError("Invalid JSON body");
  }

  const parsed = publicUploadRequestSchema.safeParse(body);
  if (!parsed.success) {
    return apiError(parsed.error.issues[0]?.message ?? "Invalid upload request", 422);
  }
  const input = parsed.data;
  const file = { contentType: uploadContentType(input.contentType), size: input.size };

  const tooBig = candidateUploadError(input.bucket, file);
  if (tooBig) return apiError(tooBig, 413);

  try {
    let positionId: string | null = null;

    if (input.positionId) {
      const { data: open, error } = await supabase.rpc("public_position_is_open", {
        p_position_id: input.positionId,
      });
      if (error) return apiError(error.message, 500);
      if (open) positionId = input.positionId;
    } else if (input.questionnaireToken && isQuestionnaireTokenShape(input.questionnaireToken)) {
      const { data: resolved, error } = await supabase
        .rpc("public_questionnaire_by_token", { p_token: input.questionnaireToken })
        .maybeSingle();
      if (error) return apiError(error.message, 500);
      positionId = resolved?.position_id ?? null;
    }

    if (!positionId) return apiError(NOT_ACCEPTING_UPLOADS, 404);

    const refused = await guardPublicSubmission(supabase, request, { kind: "upload" });
    if (refused) return refused;

    const storagePath = applicationStoragePath(positionId, input.filename);
    const uploadUrl = await signUpload(input.bucket, storagePath, file);

    const ticket: PublicUploadTicket = { storagePath, uploadUrl, contentType: file.contentType };
    return NextResponse.json(ticket, { status: 201 });
  } catch (error) {
    if (error instanceof MissingObjectStorageError) return apiError(NOT_ACCEPTING_UPLOADS, 503);
    return apiUnexpected(error);
  }
}
