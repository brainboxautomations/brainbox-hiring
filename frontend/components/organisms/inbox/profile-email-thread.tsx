"use client";

import { useMemo } from "react";
import Link from "next/link";

import { cn } from "@/utilities/cn";
import { apiErrorMessage } from "@/utilities/api-error";
import { htmlToPlainText } from "@/utilities/email-headers";
import { formatFileSize } from "@/utilities/message-attachments";
import { messageTimestamp } from "@/utilities/relative-time";
import { usePersonMessages } from "@/hooks/use-messages";
import type { Message } from "@/types/api";
import { MailIcon } from "@/components/atoms/icons";
import { MessageBody } from "@/components/molecules/message-body";
import { ScheduledSendStatus } from "@/components/molecules/scheduled-send-status";

type ThreadGroup = {
  threadId: string;
  subject: string;
  messages: Message[];
};

function groupByThread(messages: Message[]): ThreadGroup[] {
  const ordered = messages
    .slice()
    .sort(
      (a, b) =>
        new Date(a.sentAt ?? a.createdAt).getTime() - new Date(b.sentAt ?? b.createdAt).getTime(),
    );

  const groups = new Map<string, ThreadGroup>();

  for (const message of ordered) {
    const key = message.threadId ?? `loose-${message.id}`;
    const existing = groups.get(key);
    if (existing) {
      existing.messages.push(message);
      continue;
    }
    groups.set(key, {
      threadId: message.threadId ?? "",
      subject: message.subject ?? "(no subject)",
      messages: [message],
    });
  }

  return [...groups.values()].reverse();
}

export function ProfileEmailThread({
  personId,
  personFirstName,
  applicationId,
}: {
  personId: string;
  personFirstName: string;
  applicationId: string;
}) {
  const messagesQuery = usePersonMessages(personId);
  const groups = useMemo(() => groupByThread(messagesQuery.data ?? []), [messagesQuery.data]);

  if (messagesQuery.isPending) {
    return (
      <div className="flex flex-1 items-center justify-center text-xs text-slate-400">
        Loading the email thread…
      </div>
    );
  }

  if (messagesQuery.isError) {
    return (
      <div className="flex flex-1 items-center justify-center px-6 text-center text-xs text-red-600">
        {apiErrorMessage(messagesQuery.error, "Couldn’t load the email thread.")}
      </div>
    );
  }

  if (groups.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 px-6 text-center">
        <MailIcon size={22} className="text-slate-300" />
        <div className="text-[13px] font-medium text-slate-600">No email yet</div>
        <div className="max-w-65 text-[11px] leading-relaxed text-slate-400">
          Nothing has been sent to {personFirstName} yet. Replies route back through the relay and
          land here.
        </div>
        <Link
          href={`/compose?applicationId=${applicationId}`}
          className="mt-1.5 inline-flex h-7.5 items-center rounded-[7px] border border-slate-300 bg-white px-2.75 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50"
        >
          Send email
        </Link>
      </div>
    );
  }

  return (
    <>
      <div className="flex flex-1 flex-col gap-4 overflow-y-auto p-4">
        {groups.map((group) => (
          <div key={group.threadId || group.messages[0]?.id} className="flex flex-col gap-2.5">
            <div className="flex items-center gap-2">
              <span className="min-w-0 flex-1 truncate text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-400">
                {group.subject}
              </span>
              {group.threadId && (
                <Link
                  href={`/inbox/${group.threadId}`}
                  className="shrink-0 text-[11px] font-medium text-accent-11 hover:underline"
                >
                  Open in Inbox
                </Link>
              )}
            </div>

            {group.messages.map((message) => {
              const outbound = message.direction === "outbound";
              const body = outbound ? htmlToPlainText(message.body) : (message.body ?? "");

              return (
                <div
                  key={message.id}
                  className={cn("flex flex-col", outbound ? "items-end" : "items-start")}
                >
                  <div
                    className={cn(
                      "mb-1 flex flex-wrap items-center gap-1.5",
                      outbound ? "justify-end" : "justify-start",
                    )}
                  >
                    <span className="text-[11px] font-semibold text-slate-600">
                      {outbound ? (message.senderName ?? "Team") : personFirstName}
                    </span>
                    <span className="whitespace-nowrap font-mono text-[10px] text-slate-400">
                      {messageTimestamp(message.sentAt ?? message.createdAt)}
                    </span>
                    <ScheduledSendStatus message={message} />
                  </div>
                  <div
                    className={cn(
                      "max-w-[88%] whitespace-pre-wrap rounded-lg border px-2.5 py-2 text-xs leading-relaxed",
                      outbound
                        ? "border-accent-4 bg-accent-3 text-accent-12"
                        : "border-slate-200 bg-white text-slate-700",
                    )}
                  >
                    <MessageBody body={body} collapseQuotedText={!outbound} />
                  </div>
                  {message.attachments.length > 0 && (
                    <div className="mt-1 flex flex-wrap gap-1">
                      {message.attachments.map((attachment) => (
                        <span
                          key={attachment.path}
                          className="rounded border border-slate-200 bg-white px-1.5 py-0.5 text-[10px] text-slate-500"
                        >
                          {attachment.filename} · {formatFileSize(attachment.size)}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ))}
      </div>

      <div className="flex shrink-0 justify-end border-t border-slate-100 px-4 pb-3.5 pt-2.5">
        <Link
          href={`/compose?applicationId=${applicationId}`}
          className="inline-flex h-7.5 items-center rounded-[7px] border border-slate-300 bg-white px-2.75 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50"
        >
          Send email
        </Link>
      </div>
    </>
  );
}
