import { NextResponse, type NextRequest } from "next/server";

import { serverEnv } from "@/configurations/env-configuration";
import { readBoundedRequestText } from "@/app/api/_helpers";
import { getEmailTransport } from "@/configurations/email-transport";
import { getSlackTransport } from "@/configurations/slack-transport";
import {
  MissingServiceRoleKeyError,
  createSupabaseServiceClient,
} from "@/configurations/supabase-service-configuration";
import { processInboundEmail } from "@/app/api/webhooks/resend/inbound/_receive";
import { notifySlackOfInboundEmail } from "@/app/api/webhooks/resend/inbound/_slack-notifier";
import {
  RECEIVED_EVENT_TYPE,
  receivedEmailDataSchema,
  webhookEventSchema,
} from "@/schemas/inbound-webhook-schema";
import { readSignatureHeaders, verifyWebhookSignature } from "@/utilities/webhook-signature";

const MAX_PAYLOAD_BYTES = 1_000_000;

export async function POST(request: NextRequest) {
  const { RESEND_WEBHOOK_SECRET, APP_BASE_URL } = serverEnv();

  if (!RESEND_WEBHOOK_SECRET) {
    return NextResponse.json(
      { error: "RESEND_WEBHOOK_SECRET is not configured; inbound mail cannot be verified" },
      { status: 503 },
    );
  }

  const read = await readBoundedRequestText(request, MAX_PAYLOAD_BYTES);
  if ("tooLarge" in read) {
    return NextResponse.json({ error: "Payload too large" }, { status: 413 });
  }
  const payload = read.text;

  const verdict = await verifyWebhookSignature({
    secret: RESEND_WEBHOOK_SECRET,
    headers: readSignatureHeaders(request.headers),
    payload,
  });

  if (!verdict.ok) {
    return NextResponse.json({ error: verdict.reason }, { status: 401 });
  }

  let body: unknown;
  try {
    body = JSON.parse(payload);
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const event = webhookEventSchema.safeParse(body);
  if (!event.success) {
    return NextResponse.json(
      { error: event.error.issues[0]?.message ?? "Unrecognised webhook payload" },
      { status: 422 },
    );
  }

  if (event.data.type !== RECEIVED_EVENT_TYPE) {
    return NextResponse.json({ status: "ignored", type: event.data.type });
  }

  const received = receivedEmailDataSchema.safeParse(event.data.data ?? {});
  if (!received.success) {
    return NextResponse.json(
      { error: received.error.issues[0]?.message ?? "Missing email_id" },
      { status: 422 },
    );
  }

  let supabase;
  try {
    supabase = createSupabaseServiceClient();
  } catch (error) {
    if (error instanceof MissingServiceRoleKeyError) {
      return NextResponse.json(
        { error: "SUPABASE_SERVICE_ROLE_KEY is not configured; inbound mail cannot be stored" },
        { status: 503 },
      );
    }
    throw error;
  }

  const outcome = await processInboundEmail(supabase, getEmailTransport(), received.data.email_id);

  if (outcome.kind === "error") {
    return NextResponse.json({ error: outcome.error }, { status: 500 });
  }

  if (outcome.kind === "duplicate") {
    return NextResponse.json({ status: "duplicate" });
  }

  if (outcome.kind === "unmatched") {
    return NextResponse.json({ status: "unmatched", reason: outcome.reason });
  }

  const slack = await notifySlackOfInboundEmail(supabase, getSlackTransport(), {
    messageId: outcome.messageId,
    appBaseUrl: APP_BASE_URL,
  });

  return NextResponse.json({
    status: "recorded",
    messageId: outcome.messageId,
    threadId: outcome.threadId,
    slack: slack.kind,
  });
}
