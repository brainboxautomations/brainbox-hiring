import { z } from "zod";

import { MAX_BODY_LENGTH, MAX_SUBJECT_LENGTH } from "@/schemas/message-template-schema";
import { isEmailAddress } from "@/utilities/email-address";

export const MAX_RECIPIENTS_PER_FIELD = 25;

const addressList = z
  .array(z.string().trim())
  .max(MAX_RECIPIENTS_PER_FIELD, "Too many recipients")
  .default([])
  .refine(
    (entries) => entries.every((entry) => entry.length === 0 || isEmailAddress(entry)),
    "One of those addresses is not a valid email address",
  );

export const sendMessageSchema = z
  .object({
    applicationId: z.uuid("applicationId must be a uuid").nullish(),
    personId: z.uuid("personId must be a uuid").nullish(),
    threadId: z.uuid("threadId must be a uuid").nullish(),

    subject: z
      .string()
      .trim()
      .min(1, "A subject is required")
      .max(MAX_SUBJECT_LENGTH, "Subject is too long"),

    body: z.string().min(1, "The message body is empty").max(MAX_BODY_LENGTH, "Body is too long"),

    cc: addressList,
    bcc: addressList,

    scheduledFor: z.iso
      .datetime({ message: "scheduledFor must be an ISO 8601 datetime" })
      .nullish(),

    templateId: z.uuid("templateId must be a uuid").nullish(),
  })
  .refine(
    (value) => Boolean(value.applicationId) || Boolean(value.personId),
    "A message needs either an applicationId or a personId",
  );

export type SendMessageValues = z.infer<typeof sendMessageSchema>;
