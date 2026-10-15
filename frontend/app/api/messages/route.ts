import { NextResponse, type NextRequest } from "next/server";

import { companyEnv } from "@/configurations/env-configuration";
import { putObject } from "@/configurations/object-storage";
import { apiError, apiUnexpected, requireUser } from "@/app/api/_helpers";
import { readEmailTiming, undoWindowSendTime } from "@/app/api/_email-timing";
import { mapMessage } from "@/app/api/_mappers";
import {
  MESSAGE_SELECT,
  dispatchMessage,
  displaySenderName,
  loadSendTarget,
} from "@/app/api/messages/_send";
import { sendMessageSchema } from "@/schemas/message-schema";
import type { MessageAttachment } from "@/types/api";
import { parseEmailList } from "@/utilities/email-address";
import {
  MAX_ATTACHMENT_BYTES,
  MAX_ATTACHMENT_COUNT,
  MAX_TOTAL_ATTACHMENT_BYTES,
  MESSAGE_ATTACHMENT_BUCKET,
  messageAttachmentPath,
} from "@/utilities/message-attachments";
import { planScheduledSend } from "@/utilities/scheduled-send";

export async function GET(request: NextRequest) {
  const ctx = await requireUser();
  if (ctx instanceof NextResponse) return ctx;
  const { supabase } = ctx;

  const personId = request.nextUrl.searchParams.get("personId");
  const applicationId = request.nextUrl.searchParams.get("applicationId");

  if (!personId && !applicationId) {
    return apiError("Pass personId or applicationId", 422);
  }

  let query = supabase.from("messages").select(MESSAGE_SELECT);
  query = personId ? query.eq("person_id", personId) : query.eq("application_id", applicationId!);

  const { data, error } = await query.order("created_at", { ascending: false }).limit(200);
  if (error) return apiError(error.message, 500);

  return NextResponse.json({ messages: (data ?? []).map(mapMessage) });
}

export async function POST(request: NextRequest) {
  const ctx = await requireUser();
  if (ctx instanceof NextResponse) return ctx;
  const { supabase, user } = ctx;

  const contentType = request.headers.get("content-type") ?? "";
  let payloadJson: unknown;
  let files: File[] = [];

  if (contentType.includes("multipart/form-data")) {
    let form: FormData;
    try {
      form = await request.formData();
    } catch {
      return apiError("Could not read the multipart body");
    }

    const raw = form.get("payload");
    if (typeof raw !== "string") return apiError("Missing payload");
    try {
      payloadJson = JSON.parse(raw);
    } catch {
      return apiError("Invalid payload JSON");
    }

    files = form.getAll("attachments").filter((entry): entry is File => entry instanceof File);
  } else {
    try {
      payloadJson = await request.json();
    } catch {
      return apiError("Invalid JSON body");
    }
  }

  const parsed = sendMessageSchema.safeParse(payloadJson);
  if (!parsed.success) {
    return apiError(parsed.error.issues[0]?.message ?? "Invalid message", 422);
  }
  const payload = parsed.data;

  if (files.length > MAX_ATTACHMENT_COUNT) {
    return apiError(`A message may carry at most ${MAX_ATTACHMENT_COUNT} attachments`, 422);
  }
  const totalBytes = files.reduce((sum, file) => sum + file.size, 0);
  if (files.some((file) => file.size > MAX_ATTACHMENT_BYTES)) {
    return apiError("One of those attachments is larger than 10 MB", 422);
  }
  if (totalBytes > MAX_TOTAL_ATTACHMENT_BYTES) {
    return apiError("Those attachments come to more than 20 MB in total", 422);
  }

  const schedule = planScheduledSend({ requestedFor: payload.scheduledFor, now: new Date() });
  if (schedule.kind === "rejected") return apiError(schedule.reason, 422);
  const scheduledFor = schedule.kind === "scheduled" ? schedule.sendAt : null;

  try {
    const loaded = await loadSendTarget(supabase, {
      applicationId: payload.applicationId,
      personId: payload.personId,
    });
    if ("error" in loaded) return apiError(loaded.error, loaded.status);
    const { target } = loaded;

    const { data: profile } = await supabase
      .from("profiles")
      .select("full_name, email")
      .eq("id", user.id)
      .maybeSingle();

    const senderDisplayName = displaySenderName({
      origin: "manual",
      userFullName: profile?.full_name,
      userEmail: profile?.email ?? user.email,
      positionSenderName: target.position?.email_sender_name,
      companyName: companyEnv().COMPANY_NAME,
    });

    const attachments: MessageAttachment[] = [];
    for (const file of files) {
      const path = messageAttachmentPath(user.id, file.name);
      try {
        await putObject(
          MESSAGE_ATTACHMENT_BUCKET,
          path,
          new Uint8Array(await file.arrayBuffer()),
          file.type || "application/octet-stream",
        );
      } catch (error) {
        const reason = error instanceof Error ? error.message : "storage unavailable";
        return apiError(`Attachment upload failed: ${reason}`, 500);
      }

      attachments.push({
        path,
        filename: file.name || "attachment",
        mimeType: file.type || null,
        size: file.size,
      });
    }

    const result = await dispatchMessage(supabase, {
      target,
      senderDisplayName,
      senderUserId: user.id,
      subjectTemplate: payload.subject,
      bodyTemplate: payload.body,
      cc: parseEmailList(payload.cc),
      bcc: parseEmailList(payload.bcc),
      attachments,
      // Sent "now", it is still held for the undo window (Settings), so a
      // slip can be taken back; Send now skips the wait.
      scheduledFor: scheduledFor ?? undoWindowSendTime(await readEmailTiming(supabase), new Date()),
      threadId: payload.threadId,
      // Past the relay's daily limit, the email is kept and sent just after
      // the reset instead of failing; it shows in the thread as scheduled.
      onDailyLimit: "schedule",
    });

    if (result.outcome === "failed") {
      return apiError(result.error, result.status);
    }

    const { data, error } = await supabase
      .from("messages")
      .select(MESSAGE_SELECT)
      .eq("id", result.messageId)
      .single();

    if (error || !data) return apiError(error?.message ?? "Message not found", 500);

    return NextResponse.json({ message: mapMessage(data) }, { status: 201 });
  } catch (error) {
    return apiUnexpected(error);
  }
}
