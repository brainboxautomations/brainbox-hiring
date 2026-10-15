"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useNavigate } from "@/hooks/use-navigate";
import { ComposeCandidatePicker } from "@/components/organisms/compose-candidate-picker";
import { Mail, Paperclip, Plus, Search, Send } from "lucide-react";

import { cn } from "@/utilities/cn";
import { apiErrorMessage } from "@/utilities/api-error";
import { initialsFor, invalidEmailEntries } from "@/utilities/email-address";
import { htmlToPlainText, replySubject } from "@/utilities/email-headers";
import { inboxTimestamp, messageTimestamp } from "@/utilities/relative-time";
import {
  MAX_ATTACHMENT_BYTES,
  MAX_ATTACHMENT_COUNT,
  MAX_TOTAL_ATTACHMENT_BYTES,
  formatFileSize,
} from "@/utilities/message-attachments";
import { useSendMessage } from "@/hooks/use-messages";
import { useScheduleSend } from "@/hooks/use-schedule-send";
import { usePositions } from "@/hooks/use-positions";
import { useMarkThreadRead, useThread, useThreads, useUnmatchedInbound } from "@/hooks/use-threads";
import type { Message, MessageThread, MessageThreadDetail } from "@/types/api";
import { ChevronRightIcon } from "@/components/atoms/icons";
import { Tooltip } from "@/components/atoms/tooltip";
import { MessageBody } from "@/components/molecules/message-body";
import {
  ScheduleSendPicker,
  ScheduleSendToggle,
} from "@/components/molecules/schedule-send-control";
import { ScheduledSendStatus } from "@/components/molecules/scheduled-send-status";

type Scope = "global" | "position";
type ListMode = "threads" | "unmatched";

const AVATAR_PALETTE = [
  { bg: "#edf2fe", color: "#3657c3" },
  { bg: "#DCFCE7", color: "#15803D" },
  { bg: "#FEF3C7", color: "#B45309" },
  { bg: "#EDE9FE", color: "#6D28D9" },
  { bg: "#FFE4E6", color: "#BE123C" },
] as const;

function avatarFor(seed: string) {
  let hash = 0;
  for (let index = 0; index < seed.length; index += 1) {
    hash = (hash * 31 + seed.charCodeAt(index)) % AVATAR_PALETTE.length;
  }
  return AVATAR_PALETTE[hash] ?? AVATAR_PALETTE[0];
}

function ComposeIcon() {
  return <Plus size={13} aria-hidden="true" />;
}

function PaperclipIcon() {
  return <Paperclip size={15} aria-hidden="true" />;
}

function SendIcon() {
  return <Send size={13} aria-hidden="true" />;
}

function MailGlyph({ size = 20 }: { size?: number }) {
  return <Mail size={size} color="#94A3B8" aria-hidden="true" />;
}

function StagePill({ label, className }: { label: string; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-2.5 text-xs font-medium text-slate-600",
        className,
      )}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-slate-400" />
      {label}
    </span>
  );
}

function ListSkeleton() {
  return (
    <>
      {[1, 2, 3, 4, 5, 6].map((row) => (
        <div key={row} className="flex gap-2.75 border-b border-slate-100 px-4 py-3.25">
          <div className="h-8.5 w-8.5 shrink-0 animate-[ds-shimmer_1.4s_infinite] rounded-full bg-[linear-gradient(90deg,#F1F5F9_25%,#E2E8F0_37%,#F1F5F9_63%)] bg-[length:400px_100%]" />
          <div className="flex flex-1 flex-col gap-1.75">
            <div className="h-2.25 w-[55%] animate-[ds-shimmer_1.4s_infinite] rounded bg-[linear-gradient(90deg,#F1F5F9_25%,#E2E8F0_37%,#F1F5F9_63%)] bg-[length:400px_100%]" />
            <div className="h-2 w-[85%] animate-[ds-shimmer_1.4s_infinite] rounded bg-[linear-gradient(90deg,#F1F5F9_25%,#E2E8F0_37%,#F1F5F9_63%)] bg-[length:400px_100%]" />
          </div>
        </div>
      ))}
    </>
  );
}

function EmptyList({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="flex flex-col items-center px-6 py-15 text-center">
      <div className="mb-3.25 flex h-10.5 w-10.5 items-center justify-center rounded-xl bg-slate-100">
        <MailGlyph />
      </div>
      <div className="mb-1 text-[13px] font-semibold">{title}</div>
      <div className="text-xs leading-relaxed text-slate-400">{detail}</div>
    </div>
  );
}

function MessageBubble({ message }: { message: Message }) {
  const outbound = message.direction === "outbound";
  const sender = outbound ? (message.senderName ?? "Team") : (message.fromAddress ?? "Candidate");
  const body = outbound ? htmlToPlainText(message.body) : (message.body ?? "");

  return (
    <div className={cn("flex flex-col", outbound ? "items-end" : "items-start")}>
      <div className="mb-1.25 flex items-center gap-1.75">
        <span className="text-xs font-semibold text-slate-700">{sender}</span>
        <span className="font-mono text-[10px] text-slate-400">
          {messageTimestamp(message.sentAt ?? message.createdAt)}
        </span>
        <ScheduledSendStatus message={message} />
      </div>
      <div
        className={cn(
          "max-w-[78%] whitespace-pre-wrap rounded-xl border px-3.5 py-2.75 text-[13px] leading-relaxed",
          outbound
            ? "border-accent-4 bg-accent-3 text-accent-12"
            : "border-slate-200 bg-white text-slate-700",
        )}
      >
        <MessageBody body={body} collapseQuotedText={!outbound} />
      </div>
      {message.attachments.length > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {message.attachments.map((attachment) => (
            <span
              key={attachment.path}
              className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2 py-1 text-[11px] text-slate-600"
            >
              <PaperclipIcon />
              {attachment.filename}
              <span className="text-slate-400">{formatFileSize(attachment.size)}</span>
            </span>
          ))}
        </div>
      )}
      {message.failureReason && (
        <div className="mt-1 text-[11px] text-amber-700">{message.failureReason}</div>
      )}
    </div>
  );
}

function ReplyBox({ thread }: { thread: MessageThreadDetail }) {
  const sendMessage = useSendMessage();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [ccShown, setCcShown] = useState(false);
  const [cc, setCc] = useState("");
  const [bcc, setBcc] = useState("");
  const [body, setBody] = useState("");
  const [attachments, setAttachments] = useState<File[]>([]);
  const [error, setError] = useState<string | null>(null);
  const schedule = useScheduleSend();

  function addFiles(list: FileList | null) {
    if (!list) return;
    const incoming = [...list];
    const tooBig = incoming.find((file) => file.size > MAX_ATTACHMENT_BYTES);
    if (tooBig) {
      setError(`${tooBig.name} is larger than ${formatFileSize(MAX_ATTACHMENT_BYTES)}.`);
      return;
    }
    const next = [...attachments, ...incoming];
    if (next.length > MAX_ATTACHMENT_COUNT) {
      setError(`A message may carry at most ${MAX_ATTACHMENT_COUNT} attachments.`);
      return;
    }
    if (next.reduce((sum, file) => sum + file.size, 0) > MAX_TOTAL_ATTACHMENT_BYTES) {
      setError(
        `Those attachments come to more than ${formatFileSize(MAX_TOTAL_ATTACHMENT_BYTES)} in total.`,
      );
      return;
    }
    setError(null);
    setAttachments(next);
  }

  async function submit() {
    setError(null);
    if (body.trim().length === 0) {
      setError("Write something before sending.");
      return;
    }

    const badAddresses = [...invalidEmailEntries(cc), ...invalidEmailEntries(bcc)];
    if (badAddresses.length > 0) {
      setError(`Not a valid email address: ${badAddresses.join(", ")}`);
      return;
    }

    const resolved = schedule.resolve();
    if (!resolved.ok) {
      setError(resolved.reason);
      return;
    }

    try {
      await sendMessage.mutateAsync({
        threadId: thread.id,
        applicationId: thread.applicationId,
        personId: thread.applicationId ? null : thread.personId,
        subject: replySubject(thread.subject),
        body,
        cc: cc
          .split(/[,;\n]/)
          .map((entry) => entry.trim())
          .filter(Boolean),
        bcc: bcc
          .split(/[,;\n]/)
          .map((entry) => entry.trim())
          .filter(Boolean),
        scheduledFor: resolved.scheduledFor,
        attachments,
      });
      setBody("");
      setAttachments([]);
      // The reply now shows in the thread above, with its send time and
      // Undo / Send now while it is held.
      schedule.reset();
    } catch (sendError) {
      setError(apiErrorMessage(sendError, "Couldn’t send — the mail relay didn’t respond."));
    }
  }

  return (
    <div className="shrink-0 border-t border-slate-200 bg-white px-4.5 py-3">
      <div className="overflow-hidden rounded-[10px] border border-slate-300">
        <div className="flex items-center gap-2 border-b border-slate-100 px-3 py-2">
          <span className="text-[11px] text-slate-400">
            Reply to {thread.personFirstName || thread.personName}
          </span>
          <div className="flex-1" />
          <button
            type="button"
            onClick={() => setCcShown((shown) => !shown)}
            className="text-[11px] text-accent-11 hover:underline"
          >
            Cc / Bcc
          </button>
        </div>
        {ccShown && (
          <div className="flex gap-2 border-b border-slate-100 px-3 py-2">
            <input
              value={cc}
              onChange={(event) => setCc(event.target.value)}
              placeholder="Cc"
              className="flex-1 bg-transparent text-xs text-slate-900 placeholder:text-slate-400 outline-none"
            />
            <input
              value={bcc}
              onChange={(event) => setBcc(event.target.value)}
              placeholder="Bcc"
              className="flex-1 border-l border-slate-100 bg-transparent pl-2 text-xs text-slate-900 placeholder:text-slate-400 outline-none"
            />
          </div>
        )}
        <textarea
          value={body}
          onChange={(event) => setBody(event.target.value)}
          placeholder="Write a reply…"
          className="min-h-18 w-full resize-none px-3 py-2.5 text-[13px] leading-relaxed text-slate-700 placeholder:text-slate-400 outline-none"
        />
        {attachments.length > 0 && (
          <div className="flex flex-wrap gap-1.5 border-t border-slate-100 px-3 py-2">
            {attachments.map((file, index) => (
              <span
                key={`${file.name}-${index}`}
                className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-[11px] text-slate-600"
              >
                {file.name}
                <button
                  type="button"
                  onClick={() => setAttachments(attachments.filter((_, i) => i !== index))}
                  className="text-slate-400 hover:text-slate-600"
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        )}
        {schedule.scheduled && (
          <div className="border-t border-slate-100 px-3 py-2">
            <ScheduleSendPicker
              id="reply-schedule-at"
              value={schedule.scheduleAt ?? ""}
              onChange={schedule.setScheduleAt}
            />
          </div>
        )}
        {error && (
          <div className="border-t border-red-100 bg-red-50 px-3 py-2 text-[11px] text-red-700">
            {error}
          </div>
        )}
        <div className="flex items-center gap-1 border-t border-slate-100 px-2.5 py-2">
          <input
            ref={fileInputRef}
            type="file"
            multiple
            className="hidden"
            onChange={(event) => {
              addFiles(event.target.files);
              event.target.value = "";
            }}
          />
          <Tooltip label="Attach">
            <button
              type="button"
              aria-label="Attach"
              onClick={() => fileInputRef.current?.click()}
              className="flex h-7.5 w-7.5 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100"
            >
              <PaperclipIcon />
            </button>
          </Tooltip>
          <ScheduleSendToggle compact scheduled={schedule.scheduled} onToggle={schedule.toggle} />
          <div className="flex-1" />
          <button
            type="button"
            onClick={submit}
            disabled={sendMessage.isPending}
            className="inline-flex h-8 items-center gap-1.75 rounded-lg bg-accent-9 px-4 text-[13px] font-medium text-white transition-colors hover:bg-accent-10 disabled:opacity-60"
          >
            <SendIcon />
            {sendMessage.isPending ? "Sending…" : schedule.scheduled ? "Schedule" : "Send"}
          </button>
        </div>
      </div>
    </div>
  );
}

export function InboxScreen({ threadId }: { threadId: string | null }) {
  const navigate = useNavigate();
  const [composePickerOpen, setComposePickerOpen] = useState(false);
  const searchParams = useSearchParams();
  const positionIdParam = searchParams.get("positionId");

  const [scope, setScope] = useState<Scope>(positionIdParam ? "position" : "global");
  const [scopedPositionId, setScopedPositionId] = useState<string | null>(positionIdParam);
  const [listMode, setListMode] = useState<ListMode>("threads");
  const [search, setSearch] = useState("");
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [selectedUnmatchedId, setSelectedUnmatchedId] = useState<string | null>(null);

  const positionsQuery = usePositions();
  const threadsQuery = useThreads({
    positionId: scope === "position" ? scopedPositionId : null,
  });
  const unmatchedQuery = useUnmatchedInbound();
  const threadQuery = useThread(threadId);
  const markRead = useMarkThreadRead();

  const threads = useMemo(() => threadsQuery.data ?? [], [threadsQuery.data]);
  const unmatched = useMemo(() => unmatchedQuery.data ?? [], [unmatchedQuery.data]);

  const visibleThreads = useMemo(() => {
    const term = search.trim().toLowerCase();
    return threads.filter((thread) => {
      if (unreadOnly && !thread.unread) return false;
      if (!term) return true;
      return (
        thread.personName.toLowerCase().includes(term) ||
        thread.personEmail.toLowerCase().includes(term) ||
        (thread.subject ?? "").toLowerCase().includes(term) ||
        thread.preview.toLowerCase().includes(term)
      );
    });
  }, [threads, unreadOnly, search]);

  const selectedThread = threadQuery.data ?? null;
  const selectedUnmatched = unmatched.find((email) => email.id === selectedUnmatchedId) ?? null;

  const markedRead = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!selectedThread?.unread) return;
    if (markedRead.current.has(selectedThread.id)) return;
    markedRead.current.add(selectedThread.id);
    markRead.mutate(selectedThread.id);
  }, [selectedThread, markRead]);

  function openThread(thread: MessageThread) {
    setSelectedUnmatchedId(null);
    const query = scope === "position" && scopedPositionId ? `?positionId=${scopedPositionId}` : "";
    navigate.push(`/inbox/${thread.id}${query}`);
  }

  const listBody = () => {
    if (listMode === "unmatched") {
      if (unmatchedQuery.isPending) return <ListSkeleton />;
      if (unmatched.length === 0) {
        return (
          <EmptyList
            title="Nothing unmatched"
            detail="Mail from an address we don't recognise is held here."
          />
        );
      }
      return unmatched.map((email) => {
        const palette = avatarFor(email.fromAddress);
        const selected = selectedUnmatchedId === email.id;
        return (
          <button
            key={email.id}
            type="button"
            onClick={() => setSelectedUnmatchedId(email.id)}
            className={cn(
              "flex w-full gap-2.75 border-b border-slate-100 px-4 py-3 text-left transition-colors",
              selected
                ? "bg-accent-2 shadow-[inset_2px_0_0_#3d63dd]"
                : "bg-white hover:bg-slate-50",
            )}
          >
            <div
              className="flex h-8.5 w-8.5 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold"
              style={{ background: palette.bg, color: palette.color }}
            >
              {initialsFor(email.fromName || email.fromAddress)}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline gap-2">
                <span className="min-w-0 flex-1 truncate text-[13px] text-slate-900">
                  {email.fromName || email.fromAddress}
                </span>
                <span className="shrink-0 font-mono text-[10px] text-slate-400">
                  {inboxTimestamp(email.receivedAt)}
                </span>
              </div>
              <div className="mb-0.75 mt-px truncate text-[11px] text-slate-400">
                {email.subject ?? "(no subject)"}
              </div>
              <div className="truncate text-xs leading-snug text-slate-400">{email.preview}</div>
            </div>
          </button>
        );
      });
    }

    if (threadsQuery.isPending) return <ListSkeleton />;
    if (threadsQuery.isError) {
      return (
        <div className="px-5 py-10 text-center text-xs text-red-600">
          {apiErrorMessage(threadsQuery.error, "Couldn’t load the inbox.")}
        </div>
      );
    }
    if (threads.length === 0) {
      return <EmptyList title="No messages" detail="Candidate replies will show up here." />;
    }
    if (visibleThreads.length === 0) {
      return <div className="px-5 py-10 text-center text-xs text-slate-400">No threads match.</div>;
    }

    return visibleThreads.map((thread) => {
      const palette = avatarFor(thread.personId);
      const selected = threadId === thread.id;
      return (
        <button
          key={thread.id}
          type="button"
          onClick={() => openThread(thread)}
          className={cn(
            "flex w-full gap-2.75 border-b border-slate-100 px-4 py-3 text-left transition-colors",
            selected ? "bg-accent-2 shadow-[inset_2px_0_0_#3d63dd]" : "bg-white hover:bg-slate-50",
          )}
        >
          <div className="relative shrink-0">
            <div
              className="flex h-8.5 w-8.5 items-center justify-center rounded-full text-[11px] font-semibold"
              style={{ background: palette.bg, color: palette.color }}
            >
              {initialsFor(thread.personName)}
            </div>
            {thread.unread && (
              <span className="absolute -right-px -top-px h-2.25 w-2.25 rounded-full border-2 border-white bg-accent-9" />
            )}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline gap-2">
              <span
                className={cn(
                  "min-w-0 flex-1 truncate text-[13px] text-slate-900",
                  thread.unread ? "font-semibold" : "font-normal",
                )}
              >
                {thread.personName}
              </span>
              <span className="shrink-0 font-mono text-[10px] text-slate-400">
                {inboxTimestamp(thread.lastMessageAt)}
              </span>
            </div>
            <div className="mb-0.75 mt-px truncate text-[11px] text-slate-400">
              {thread.positionTitle ?? "No position context"}
            </div>
            <div
              className={cn(
                "truncate text-xs leading-snug",
                thread.unread ? "font-medium text-slate-700" : "font-normal text-slate-400",
              )}
            >
              {thread.preview}
            </div>
          </div>
        </button>
      );
    });
  };

  return (
    <div className="flex h-full min-h-0 bg-slate-50">
      <div className="flex min-h-0 w-85 shrink-0 flex-col border-r border-slate-200 bg-white">
        <div className="shrink-0 border-b border-slate-100 px-4 pb-3 pt-3.5">
          <div className="mb-3 flex items-center gap-0.5 rounded-lg bg-slate-100 p-0.75">
            {(
              [
                { id: "global", label: "All positions" },
                { id: "position", label: "This position" },
              ] as { id: Scope; label: string }[]
            ).map((option) => (
              <button
                key={option.id}
                type="button"
                onClick={() => {
                  setScope(option.id);
                  setListMode("threads");
                }}
                className={cn(
                  "flex-1 rounded-md py-1.5 text-center text-xs font-medium transition-colors",
                  scope === option.id
                    ? "bg-white text-slate-900 shadow-card"
                    : "text-slate-500 hover:text-slate-700",
                )}
              >
                {option.label}
              </button>
            ))}
          </div>

          {scope === "position" && (
            <div className="mb-3 flex items-center gap-1.75 px-0.5">
              <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-green-600" />
              <select
                value={scopedPositionId ?? ""}
                onChange={(event) => setScopedPositionId(event.target.value || null)}
                className="min-w-0 flex-1 bg-transparent text-xs text-slate-600 outline-none"
              >
                <option value="">Pick a position…</option>
                {(positionsQuery.data ?? []).map((position) => (
                  <option key={position.id} value={position.id}>
                    {position.title}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div className="mb-2.5 flex h-8 items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-2.5">
            <Search size={13} color="#94A3B8" className="shrink-0" aria-hidden="true" />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search messages…"
              className="min-w-0 flex-1 bg-transparent text-xs text-slate-900 placeholder:text-slate-400 outline-none"
            />
          </div>

          <div className="flex items-center justify-between">
            <span className="flex items-center gap-2.5">
              <span className="text-xs text-slate-400">
                {listMode === "threads"
                  ? `${visibleThreads.length} conversations`
                  : `${unmatched.length} unmatched`}
              </span>
              {selectedThread?.applicationId ? (
                <Link
                  href={`/compose?applicationId=${selectedThread.applicationId}`}
                  title="New email to this candidate"
                  className="inline-flex items-center gap-1.25 text-xs font-medium text-accent-11"
                >
                  <ComposeIcon />
                  Compose
                </Link>
              ) : (
                // An email needs a candidate to go to. With no conversation
                // selected this used to link to Positions, with only a hover
                // tooltip to explain, so it read as a broken button. It now
                // asks who the email is for.
                <button
                  type="button"
                  onClick={() => setComposePickerOpen(true)}
                  title="Choose a candidate to email"
                  className="inline-flex items-center gap-1.25 text-xs font-medium text-accent-11"
                >
                  <ComposeIcon />
                  Compose
                </button>
              )}
            </span>
            <button
              type="button"
              onClick={() => {
                setUnreadOnly((on) => !on);
                setListMode("threads");
              }}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium transition-colors",
                unreadOnly && listMode === "threads"
                  ? "bg-accent-3 text-accent-11"
                  : "bg-slate-100 text-slate-500",
              )}
            >
              <span
                className={cn(
                  "h-1.5 w-1.5 rounded-full",
                  unreadOnly && listMode === "threads" ? "bg-accent-9" : "bg-slate-300",
                )}
              />
              Unread
            </button>
          </div>

          {unmatched.length > 0 && (
            <button
              type="button"
              onClick={() => setListMode(listMode === "unmatched" ? "threads" : "unmatched")}
              className={cn(
                "mt-2.5 flex w-full items-center gap-2 rounded-md border px-2.5 py-1.5 text-[11px] font-medium transition-colors",
                listMode === "unmatched"
                  ? "border-amber-300 bg-amber-100 text-amber-900"
                  : "border-amber-200 bg-amber-50 text-amber-800 hover:bg-amber-100",
              )}
            >
              <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
              {unmatched.length} unmatched {unmatched.length === 1 ? "email" : "emails"}
            </button>
          )}
        </div>

        <div className="ib-scroll min-h-0 flex-1 overflow-y-auto">{listBody()}</div>
      </div>

      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        {selectedUnmatched ? (
          <>
            <div className="flex h-14 shrink-0 items-center gap-3 border-b border-slate-200 bg-white px-4.5">
              <div className="min-w-0">
                <div className="truncate text-sm font-semibold text-slate-900">
                  {selectedUnmatched.fromName || selectedUnmatched.fromAddress}
                </div>
                <div className="truncate text-[11px] text-slate-400">
                  {selectedUnmatched.subject ?? "(no subject)"}
                </div>
              </div>
            </div>
            <div className="ib-scroll min-h-0 flex-1 overflow-y-auto bg-slate-50 px-6 py-5.5">
              <div className="mx-auto flex max-w-170 flex-col gap-4">
                <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-[11px] leading-relaxed text-amber-800">
                  {selectedUnmatched.reason === "sender_unreadable"
                    ? "This message arrived with a From header we could not read, so it belongs to no candidate."
                    : `${selectedUnmatched.fromAddress} is not a Person on file, so this message is not attached to any candidate. It is kept here rather than discarded.`}
                </div>
                <div className="whitespace-pre-wrap rounded-xl border border-slate-200 bg-white px-3.5 py-2.75 text-[13px] leading-relaxed text-slate-700">
                  {selectedUnmatched.bodyText || "(no body)"}
                </div>
                {selectedUnmatched.attachmentCount > 0 && (
                  <div className="text-[11px] text-slate-500">
                    {selectedUnmatched.attachmentCount} attachment
                    {selectedUnmatched.attachmentCount === 1 ? "" : "s"} were left with the relay.
                  </div>
                )}
              </div>
            </div>
          </>
        ) : threadId && threadQuery.isPending ? (
          <div className="flex flex-1 items-center justify-center text-[13px] text-slate-400">
            Loading conversation…
          </div>
        ) : threadId && threadQuery.isError ? (
          <div className="flex flex-1 items-center justify-center px-6 text-center text-[13px] text-red-600">
            {apiErrorMessage(threadQuery.error, "Couldn’t load that conversation.")}
          </div>
        ) : selectedThread ? (
          <>
            <div className="flex h-14 shrink-0 items-center gap-3 border-b border-slate-200 bg-white px-4.5">
              <div className="min-w-0">
                <div className="truncate text-sm font-semibold text-slate-900">
                  {selectedThread.personName}
                </div>
                <div className="truncate text-[11px] text-slate-400">
                  {selectedThread.subject ?? "(no subject)"}
                </div>
              </div>
              <div className="flex-1" />
              {selectedThread.stageName && (
                <StagePill label={selectedThread.stageName} className="h-6" />
              )}
            </div>

            <div className="ib-scroll min-h-0 flex-1 overflow-y-auto bg-slate-50 px-6 py-5.5">
              <div className="mx-auto flex max-w-170 flex-col gap-4">
                {selectedThread.messages.map((message) => (
                  <MessageBubble key={message.id} message={message} />
                ))}
              </div>
            </div>

            <ReplyBox key={selectedThread.id} thread={selectedThread} />
          </>
        ) : (
          <div className="flex flex-1 flex-col items-center justify-center text-slate-400">
            <div className="mb-3.5 flex h-11.5 w-11.5 items-center justify-center rounded-xl bg-slate-100">
              <MailGlyph size={22} />
            </div>
            <div className="text-[13px]">Select a conversation to read</div>
          </div>
        )}
      </div>

      {selectedThread && !selectedUnmatched && (
        <div className="ib-scroll flex w-72 shrink-0 flex-col overflow-y-auto border-l border-slate-200 bg-white px-4.5 py-5">
          <div className="flex flex-col items-center border-b border-slate-100 pb-4.5 text-center">
            <div
              className="mb-2.5 flex h-13 w-13 items-center justify-center rounded-full text-[17px] font-semibold"
              style={{
                background: avatarFor(selectedThread.personId).bg,
                color: avatarFor(selectedThread.personId).color,
              }}
            >
              {initialsFor(selectedThread.personName)}
            </div>
            <div className="text-[15px] font-semibold tracking-[-0.01em]">
              {selectedThread.personName}
            </div>
            {selectedThread.personHeadline && (
              <div className="mt-0.5 text-xs text-slate-500">{selectedThread.personHeadline}</div>
            )}
          </div>

          <div className="flex flex-col gap-2.75 border-b border-slate-100 py-4">
            <div className="flex items-baseline gap-2.5">
              <span className="w-15.5 shrink-0 text-[11px] text-slate-400">Position</span>
              <span className="text-xs text-slate-700">{selectedThread.positionTitle ?? "—"}</span>
            </div>
            {selectedThread.stageName && (
              <div className="flex items-center gap-2.5">
                <span className="w-15.5 shrink-0 text-[11px] text-slate-400">Stage</span>
                <StagePill label={selectedThread.stageName} className="h-5" />
              </div>
            )}
            <div className="flex items-baseline gap-2.5">
              <span className="w-15.5 shrink-0 text-[11px] text-slate-400">Email</span>
              <span className="min-w-0 truncate text-xs text-accent-11">
                {selectedThread.personEmail}
              </span>
            </div>
            <div className="flex items-baseline gap-2.5">
              <span className="w-15.5 shrink-0 text-[11px] text-slate-400">Phone</span>
              <span className="text-xs text-slate-700">{selectedThread.personPhone ?? "—"}</span>
            </div>
          </div>

          {selectedThread.applicationId && (
            <Link
              href={`/candidates/${selectedThread.applicationId}`}
              className="mt-4 inline-flex h-8.5 items-center justify-center gap-1.75 rounded-lg border border-slate-300 bg-white text-[13px] font-medium text-slate-700 transition-colors hover:border-slate-400 hover:bg-slate-50"
            >
              Open full profile
              <ChevronRightIcon size={13} />
            </Link>
          )}
        </div>
      )}

      {/* Mounted only while open, so it starts with an empty search each time. */}
      {composePickerOpen && (
        <ComposeCandidatePicker open onClose={() => setComposePickerOpen(false)} />
      )}
    </div>
  );
}
