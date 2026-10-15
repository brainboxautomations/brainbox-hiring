"use client";

import { useState } from "react";

import { Badge } from "@/components/atoms/badge";
import { Button } from "@/components/atoms/button";
import { Card, SectionLabel } from "@/components/atoms/card";
import { Field, Input } from "@/components/atoms/input";
import { Toggle } from "@/components/atoms/toggle";
import { ErrorAlert } from "@/components/molecules/error-alert";
import {
  InfoNote,
  LoadingBlock,
  SectionHeading,
} from "@/components/organisms/settings/section-parts";
import { useSaveSlackSettings, useSaveSlackToken, useSlackSettings } from "@/hooks/use-settings";
import { SLACK_CHANNEL_ID_MESSAGE, slackConfigSchema } from "@/schemas/settings-schema";
import { apiErrorMessage } from "@/utilities/api-error";
import type { SlackSettings } from "@/types/api";

export const SLACK_SCOPE_NOTE =
  "This posts inbound candidate email only. Stage moves and outbound email never post, and nothing can be done to a candidate from Slack.";

export const SLACK_TOKEN_WRITE_ONLY_NOTE =
  "The token is stored where the browser cannot read it and is never shown again — not even partially. If you lose it, create a new one in Slack and replace it here.";

function tokenSetLabel(settings: SlackSettings): string {
  if (!settings.tokenConfigured) return "No bot token";
  if (!settings.tokenSetAt) return "Bot token stored";
  return `Bot token stored on ${new Date(settings.tokenSetAt).toLocaleDateString()}`;
}

function TokenCard({ settings }: { settings: SlackSettings }) {
  const [token, setToken] = useState("");
  const [replacing, setReplacing] = useState(false);
  const save = useSaveSlackToken();

  const showInput = replacing || !settings.tokenConfigured;

  function submit(value: string) {
    save.mutate(
      { token: value },
      {
        onSuccess: () => {
          setToken("");
          setReplacing(false);
        },
      },
    );
  }

  return (
    <Card className="mb-3.5 p-5">
      <SectionLabel className="mb-3.5">Bot token</SectionLabel>

      <div className="mb-4 flex items-center gap-3">
        <div className="flex-1 text-[13px] text-slate-700">{tokenSetLabel(settings)}</div>
        <Badge tone={settings.tokenConfigured ? "green" : "neutral"} dot>
          {settings.tokenConfigured ? "Stored" : "Not set"}
        </Badge>
      </div>

      {showInput ? (
        <>
          <Field
            label="Paste the bot user OAuth token"
            htmlFor="slack-bot-token"
            hint="It starts with xoxb-. A user token (xoxp-) or app token (xapp-) cannot post as the app."
          >
            <Input
              id="slack-bot-token"
              type="password"
              autoComplete="off"
              spellCheck={false}
              placeholder="xoxb-…"
              value={token}
              onChange={(event) => setToken(event.target.value)}
              className="max-w-[420px]"
            />
          </Field>

          <div className="mt-3.5 flex items-center gap-2">
            <Button
              variant="primary"
              loading={save.isPending}
              disabled={token.trim().length === 0}
              onClick={() => submit(token)}
            >
              Save token
            </Button>
            {settings.tokenConfigured && (
              <Button
                onClick={() => {
                  setReplacing(false);
                  setToken("");
                }}
              >
                Cancel
              </Button>
            )}
          </div>
        </>
      ) : (
        <div className="flex items-center gap-2">
          <Button onClick={() => setReplacing(true)}>Replace token</Button>
          <Button variant="reject" loading={save.isPending} onClick={() => submit("")}>
            Remove token
          </Button>
        </div>
      )}

      {save.isError && (
        <ErrorAlert
          className="mt-3.5"
          title="Could not save the token"
          message={apiErrorMessage(save.error, "Slack would not accept that token.")}
        />
      )}

      <InfoNote className="mt-4">{SLACK_TOKEN_WRITE_ONLY_NOTE}</InfoNote>
    </Card>
  );
}

function ChannelCard({ settings }: { settings: SlackSettings }) {
  const [channelId, setChannelId] = useState(settings.channelId ?? "");
  const [channelName, setChannelName] = useState(settings.channelName ?? "");
  const [enabled, setEnabled] = useState(settings.enabled);
  const [invalid, setInvalid] = useState<string | null>(null);
  const save = useSaveSlackSettings();

  const canEnable = settings.tokenConfigured && channelId.trim().length > 0;

  function submit() {
    const candidate = {
      channelId: channelId.trim() || null,
      channelName: channelName.trim() || null,
      enabled,
    };

    const parsed = slackConfigSchema.safeParse(candidate);
    if (!parsed.success) {
      setInvalid(parsed.error.issues[0]?.message ?? SLACK_CHANNEL_ID_MESSAGE);
      return;
    }

    setInvalid(null);
    save.mutate(parsed.data);
  }

  return (
    <Card className="p-5">
      <SectionLabel className="mb-3.5">Destination</SectionLabel>

      <Field
        label="Channel ID"
        htmlFor="slack-channel-id"
        hint="Open the channel in Slack, click its name, and copy the Channel ID at the bottom of the About tab."
        error={invalid ?? undefined}
      >
        <Input
          id="slack-channel-id"
          placeholder="C0123ABCD"
          spellCheck={false}
          value={channelId}
          invalid={Boolean(invalid)}
          onChange={(event) => setChannelId(event.target.value.toUpperCase())}
          className="max-w-[320px]"
        />
      </Field>

      <Field
        label="Channel name (label only)"
        htmlFor="slack-channel-name"
        hint="Shown here so you can recognise the channel. It is never sent to Slack."
        className="mt-3.5"
      >
        <Input
          id="slack-channel-name"
          placeholder="candidate-inbox"
          value={channelName}
          onChange={(event) => setChannelName(event.target.value)}
          className="max-w-[320px]"
        />
      </Field>

      <div className="mt-4">
        <Toggle
          on={enabled}
          onToggle={() => canEnable && setEnabled((value) => !value)}
          label="Post inbound candidate email to this channel"
          className={canEnable ? undefined : "cursor-not-allowed opacity-60"}
        />
        {!canEnable && (
          <p className="mt-1.5 text-[11px] text-slate-500">
            {settings.tokenConfigured
              ? "Add a channel ID before turning notifications on."
              : "Add a bot token before turning notifications on."}
          </p>
        )}
      </div>

      <div className="mt-4">
        <Button variant="primary" loading={save.isPending} onClick={submit}>
          Save
        </Button>
      </div>

      {save.isError && (
        <ErrorAlert
          className="mt-3.5"
          title="Could not save the channel"
          message={apiErrorMessage(save.error, "Something went wrong saving the Slack settings.")}
        />
      )}

      <InfoNote className="mt-4">{SLACK_SCOPE_NOTE}</InfoNote>
    </Card>
  );
}

export function SlackSection() {
  const { data, isPending, isError, error, refetch, isFetching } = useSlackSettings();

  return (
    <>
      <SectionHeading
        title="Slack"
        description="Post inbound candidate emails to one Slack channel. Receive-only."
      />

      {isPending && <LoadingBlock rows={4} />}

      {isError && (
        <>
          <ErrorAlert
            title="Could not load the Slack settings"
            message={apiErrorMessage(error, "Something went wrong reading the Slack settings.")}
          />
          <Button className="mt-3" loading={isFetching} onClick={() => refetch()}>
            Try again
          </Button>
        </>
      )}

      {!isPending && !isError && (
        <>
          <div className="mb-3.5 flex items-center gap-3 rounded-xl border border-slate-200 bg-white p-5">
            <div className="flex-1">
              <div className="text-sm font-semibold">Inbound email notifications</div>
              <div className="mt-px text-xs text-slate-500">
                {data.enabled
                  ? `Posting to ${data.channelName ? `#${data.channelName}` : data.channelId}`
                  : "Nothing is being posted to Slack"}
              </div>
            </div>
            <Badge tone={data.enabled ? "green" : "neutral"} dot>
              {data.enabled ? "On" : "Off"}
            </Badge>
          </div>

          <TokenCard settings={data} />
          <ChannelCard
            key={`${data.channelId}|${data.channelName}|${data.enabled}|${data.tokenConfigured}`}
            settings={data}
          />
        </>
      )}
    </>
  );
}
