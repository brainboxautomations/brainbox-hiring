import { z } from "zod";

export const RECEIVED_EVENT_TYPE = "email.received";

export const webhookEventSchema = z.object({
  type: z.string().min(1, "The webhook payload carries no event type"),
  created_at: z.string().optional(),
  data: z.record(z.string(), z.unknown()).optional(),
});

export const receivedEmailDataSchema = z.object({
  email_id: z.string().min(1, "The email.received event carries no email_id"),
});

export type WebhookEvent = z.infer<typeof webhookEventSchema>;
