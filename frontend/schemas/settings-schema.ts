import { z } from "zod";

export const SLACK_CHANNEL_ID_PATTERN = /^[A-Z][A-Z0-9]{5,31}$/;

export const SLACK_CHANNEL_ID_MESSAGE =
  "A Slack channel ID looks like C0123ABCD — copy it from the channel's About tab, not the #name";

export const SLACK_BOT_TOKEN_MESSAGE =
  "A Slack bot token starts with xoxb-. A user token (xoxp-) or an app token (xapp-) cannot post as the app";

const channelId = z
  .string()
  .trim()
  .regex(SLACK_CHANNEL_ID_PATTERN, SLACK_CHANNEL_ID_MESSAGE)
  .nullable();

export const slackConfigSchema = z
  .object({
    channelId: channelId,
    channelName: z.string().trim().max(120).nullable(),
    enabled: z.boolean(),
  })
  .refine((value) => !value.enabled || value.channelId !== null, {
    path: ["channelId"],
    message: "Choose a channel before turning notifications on",
  });

export type SlackConfigInput = z.infer<typeof slackConfigSchema>;

export const slackTokenSchema = z.object({
  token: z
    .string()
    .trim()
    .refine((value) => value === "" || value.startsWith("xoxb-"), SLACK_BOT_TOKEN_MESSAGE),
});

export type SlackTokenInput = z.infer<typeof slackTokenSchema>;

const minutes = (label: string) =>
  z
    .number({ error: `${label} must be a number of minutes` })
    .int(`${label} must be whole minutes`)
    .min(0, `${label} cannot be negative`)
    .max(1440, `${label} can be at most 1440 minutes (24 hours)`);

export const emailTimingSchema = z.object({
  automationSafetyDelayMinutes: minutes("The automation safety delay"),
  sendUndoMinutes: minutes("The undo window"),
});

export type EmailTimingInput = z.infer<typeof emailTimingSchema>;
