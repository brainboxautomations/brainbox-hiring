"use client";

import { Suspense, useMemo, useRef, useState } from "react";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useNavigate } from "@/hooks/use-navigate";
import { FileText, Paperclip, Send, Table } from "lucide-react";

import { Button } from "@/components/atoms/button";
import { CloseIcon } from "@/components/atoms/icons";
import { Tooltip } from "@/components/atoms/tooltip";
import { ErrorAlert } from "@/components/molecules/error-alert";
import { FloatingMenu } from "@/components/molecules/floating-menu";
import {
  ScheduleSendPicker,
  ScheduleSendToggle,
} from "@/components/molecules/schedule-send-control";
import { MergeVariableMenu } from "@/components/organisms/merge-variable-menu";
import { useCandidateProfile } from "@/hooks/use-candidates";
import { useMessageTemplates } from "@/hooks/use-message-templates";
import { useSendMessage } from "@/hooks/use-messages";
import { useScheduleSend } from "@/hooks/use-schedule-send";
import type { CandidateProfile } from "@/types/api";
import { apiErrorMessage } from "@/utilities/api-error";
import { initialsFor, invalidEmailEntries } from "@/utilities/email-address";
import {
  buildMergeContext,
  resolveMergeVariables,
  unresolvableMergeTokens,
} from "@/utilities/merge-variables";
import {
  MAX_ATTACHMENT_BYTES,
  MAX_ATTACHMENT_COUNT,
  MAX_TOTAL_ATTACHMENT_BYTES,
  formatFileSize,
} from "@/utilities/message-attachments";
import { applyRichTextMark, type RichTextMark } from "@/utilities/rich-text";

function SendIcon() {
  return <Send size={14} aria-hidden="true" />;
}

function AttachIcon() {
  return <Paperclip size={16} aria-hidden="true" />;
}

function TemplateIcon() {
  return <Table size={16} aria-hidden="true" />;
}

function FileIcon() {
  return <FileText size={13} aria-hidden="true" />;
}

const CANDIDATE_MERGE_GROUPS = ["candidate", "custom"] as const;

const TOOLBAR: { mark: RichTextMark; label: string; title: string; weight: number }[] = [
  { mark: "bold", label: "B", title: "Bold", weight: 700 },
  { mark: "italic", label: "i", title: "Italic", weight: 500 },
  { mark: "underline", label: "U", title: "Underline", weight: 500 },
  { mark: "heading", label: "H2", title: "Heading", weight: 600 },
  { mark: "list", label: "• List", title: "Bulleted list", weight: 450 },
  { mark: "link", label: "Link", title: "Link", weight: 450 },
];

export default function ComposePage() {
  return (
    <Suspense fallback={<ComposeShellMessage title="Loading" body="Opening the composer…" />}>
      <ComposeScreen />
    </Suspense>
  );
}

function ComposeShellMessage({
  title,
  body,
  children,
}: {
  title: string;
  body: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex min-h-full items-center justify-center bg-slate-50 p-6">
      <div className="w-130 max-w-full rounded-[14px] border border-slate-200 bg-white px-6 py-10 text-center shadow-modal">
        <div className="mb-1.5 text-[15px] font-semibold text-slate-900">{title}</div>
        <div className="mx-auto mb-5 max-w-90 text-[13px] leading-[1.55] text-slate-500">
          {body}
        </div>
        {children}
      </div>
    </div>
  );
}

function ComposeScreen() {
  const params = useSearchParams();
  const applicationId = params.get("applicationId");
  const router = useRouter();
  const navigate = useNavigate();

  const profileQuery = useCandidateProfile(applicationId);

  if (!applicationId) {
    return (
      <ComposeShellMessage
        title="Pick a candidate first"
        body="Compose opens from a candidate profile so the message has someone to go to, and so merge variables can resolve."
      >
        <Link
          href="/positions"
          className="inline-flex h-8.5 items-center rounded-lg border border-slate-300 bg-white px-3.5 text-[13px] font-medium text-slate-700 transition-colors hover:bg-slate-50"
        >
          Browse positions
        </Link>
      </ComposeShellMessage>
    );
  }

  if (profileQuery.isLoading) {
    return <ComposeShellMessage title="Loading" body="Fetching the candidate…" />;
  }

  if (profileQuery.isError || !profileQuery.data) {
    return (
      <ComposeShellMessage
        title="Couldn’t load that candidate"
        body={apiErrorMessage(profileQuery.error, "The candidate could not be loaded.")}
      >
        <Button variant="secondary" className="h-8.5 rounded-lg" onClick={() => router.back()}>
          Go back
        </Button>
      </ComposeShellMessage>
    );
  }

  return (
    <Composer
      key={applicationId}
      applicationId={applicationId}
      profile={profileQuery.data}
      onClose={() => navigate.push(`/candidates/${applicationId}`)}
    />
  );
}

function Composer({
  applicationId,
  profile,
  onClose,
}: {
  applicationId: string;
  profile: CandidateProfile;
  onClose: () => void;
}) {
  const templatesQuery = useMessageTemplates();
  const sendMessage = useSendMessage();

  const [ccShown, setCcShown] = useState(false);
  const [cc, setCc] = useState("");
  const [bcc, setBcc] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [attachments, setAttachments] = useState<File[]>([]);
  const schedule = useScheduleSend();
  const [templatesOpen, setTemplatesOpen] = useState(false);
  const [varMenuOpen, setVarMenuOpen] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const templatesButtonRef = useRef<HTMLButtonElement>(null);

  const person = profile.person;
  const recipientName = [person.firstName, person.lastName].filter(Boolean).join(" ");

  const mergeContext = useMemo(
    () =>
      buildMergeContext({
        candidate: {
          firstName: person.firstName,
          lastName: person.lastName,
          email: person.email,
          phone: person.phone,
          customAttributes: person.customAttributes,
        },
        position: { title: profile.application.positionTitle },
        company: {},
        senderName: null,
      }),
    [person, profile.application.positionTitle],
  );

  // Only the candidate's own fields can be judged here. Company, sender and
  // most position values are filled in on the server at send time, so an empty
  // value for them in this context says nothing about the delivered email.
  const blankTokens = useMemo(
    () => unresolvableMergeTokens(`${subject}\n${body}`, mergeContext, CANDIDATE_MERGE_GROUPS),
    [subject, body, mergeContext],
  );

  const customKeys = useMemo(
    () => Object.keys(person.customAttributes ?? {}).sort(),
    [person.customAttributes],
  );

  const isSending = sendMessage.isPending;

  function applyMark(mark: RichTextMark) {
    const textarea = bodyRef.current;
    const start = textarea?.selectionStart ?? body.length;
    const end = textarea?.selectionEnd ?? body.length;
    const next = applyRichTextMark(body, mark, start, end);
    setBody(next.value);
    requestAnimationFrame(() => {
      textarea?.focus();
      textarea?.setSelectionRange(next.selectionStart, next.selectionEnd);
    });
  }

  function addFiles(list: FileList | null) {
    if (!list) return;
    const incoming = [...list];
    const tooBig = incoming.find((file) => file.size > MAX_ATTACHMENT_BYTES);
    if (tooBig) {
      setLocalError(`${tooBig.name} is larger than ${formatFileSize(MAX_ATTACHMENT_BYTES)}.`);
      return;
    }
    const next = [...attachments, ...incoming];
    if (next.length > MAX_ATTACHMENT_COUNT) {
      setLocalError(`A message may carry at most ${MAX_ATTACHMENT_COUNT} attachments.`);
      return;
    }
    if (next.reduce((sum, file) => sum + file.size, 0) > MAX_TOTAL_ATTACHMENT_BYTES) {
      setLocalError(
        `Those attachments come to more than ${formatFileSize(MAX_TOTAL_ATTACHMENT_BYTES)} in total.`,
      );
      return;
    }
    setLocalError(null);
    setAttachments(next);
  }

  async function submit() {
    setLocalError(null);

    if (subject.trim().length === 0) {
      setLocalError("Add a subject before sending.");
      return;
    }
    if (body.trim().length === 0) {
      setLocalError("The message body is empty.");
      return;
    }

    const badAddresses = [...invalidEmailEntries(cc), ...invalidEmailEntries(bcc)];
    if (badAddresses.length > 0) {
      setLocalError(`Not a valid email address: ${badAddresses.join(", ")}`);
      return;
    }

    const resolved = schedule.resolve();
    if (!resolved.ok) {
      setLocalError(resolved.reason);
      return;
    }

    try {
      await sendMessage.mutateAsync({
        applicationId,
        subject,
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

      // Sent, scheduled or held for the undo window, it now sits in the
      // candidate's thread with its send time and Undo / Send now.
      onClose();
    } catch (error) {
      setLocalError(apiErrorMessage(error, "Couldn’t send — the mail relay didn’t respond."));
    }
  }

  function applyTemplate(templateSubject: string, templateBody: string) {
    setSubject(templateSubject);
    setBody(templateBody);
    setTemplatesOpen(false);
  }

  function insertVariable(token: string) {
    const textarea = bodyRef.current;
    const at = textarea?.selectionStart ?? body.length;
    setBody(`${body.slice(0, at)}${token}${body.slice(at)}`);
    setVarMenuOpen(false);
  }

  const templates = templatesQuery.data ?? [];

  return (
    <div className="relative flex min-h-full items-center justify-center bg-slate-50 p-6">
      <div className="relative flex max-h-[calc(100vh-96px)] w-155 max-w-full flex-col overflow-hidden rounded-[14px] border border-slate-200 bg-white shadow-modal">
        <div className="flex shrink-0 items-center gap-2.5 border-b border-slate-200 px-4 py-3.5">
          <span className="text-[15px] font-semibold tracking-[-0.01em] text-slate-900">
            New email
          </span>
          <span className="text-xs text-slate-400">sent as you, via the BrainBox relay</span>
          <div className="flex-1" />
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex h-7 w-7 items-center justify-center rounded-[7px] text-slate-500 transition-colors hover:bg-slate-100"
          >
            <CloseIcon size={15} />
          </button>
        </div>

        {localError && (
          <div className="shrink-0 px-4 pt-3">
            <ErrorAlert title="Not sent" message={localError} />
          </div>
        )}

        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="px-4 pt-1">
            <div className="flex items-center gap-2 border-b border-slate-100 py-2.5">
              <span className="w-10 shrink-0 text-xs text-slate-400">To</span>
              <span className="inline-flex h-6.5 items-center gap-1.75 rounded-full bg-slate-100 py-0 pl-1 pr-2.5">
                <span className="flex h-4.75 w-4.75 items-center justify-center rounded-full bg-accent-3 text-[9px] font-semibold text-accent-11">
                  {initialsFor(recipientName || person.email)}
                </span>
                <span className="text-xs text-slate-700">{recipientName || person.email}</span>
              </span>
              <span className="truncate text-[11px] text-slate-400">{person.email}</span>
              <div className="flex-1" />
              {!ccShown && (
                <button
                  type="button"
                  onClick={() => setCcShown(true)}
                  className="shrink-0 text-xs text-accent-11 hover:underline"
                >
                  Cc / Bcc
                </button>
              )}
            </div>

            {ccShown && (
              <>
                <div className="flex items-center gap-2 border-b border-slate-100 py-2.5">
                  <span className="w-10 shrink-0 text-xs text-slate-400">Cc</span>
                  <input
                    value={cc}
                    onChange={(e) => setCc(e.target.value)}
                    placeholder="name@example.com"
                    aria-label="Cc"
                    className="flex-1 border-none bg-transparent text-[13px] text-slate-900 outline-none placeholder:text-slate-400"
                  />
                </div>
                <div className="flex items-center gap-2 border-b border-slate-100 py-2.5">
                  <span className="w-10 shrink-0 text-xs text-slate-400">Bcc</span>
                  <input
                    value={bcc}
                    onChange={(e) => setBcc(e.target.value)}
                    placeholder="name@example.com"
                    aria-label="Bcc"
                    className="flex-1 border-none bg-transparent text-[13px] text-slate-900 outline-none placeholder:text-slate-400"
                  />
                </div>
              </>
            )}

            <div className="flex items-center gap-2 border-b border-slate-100 py-2.5">
              <span className="w-10 shrink-0 text-xs text-slate-400">Subject</span>
              <input
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                placeholder="Subject"
                aria-label="Subject"
                className="flex-1 border-none bg-transparent text-[13px] font-medium text-slate-900 outline-none placeholder:text-slate-400"
              />
            </div>
          </div>

          <div className="px-4 py-3">
            <div className="mb-2 flex items-center gap-0.5">
              {TOOLBAR.map((tool) => (
                <button
                  key={tool.mark}
                  type="button"
                  title={tool.title}
                  aria-label={tool.title}
                  onClick={() => applyMark(tool.mark)}
                  className="flex h-6.5 min-w-7 items-center justify-center rounded-[5px] px-1.5 text-xs text-slate-600 transition-colors hover:bg-slate-100"
                  style={{
                    fontWeight: tool.weight,
                    fontStyle: tool.mark === "italic" ? "italic" : "normal",
                  }}
                >
                  {tool.label}
                </button>
              ))}
              <div className="flex-1" />
              <MergeVariableMenu
                open={varMenuOpen}
                onToggle={() => setVarMenuOpen((open) => !open)}
                onInsert={insertVariable}
                customAttributeKeys={customKeys}
              />
            </div>

            <textarea
              ref={bodyRef}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="Write your message…"
              aria-label="Message body"
              className="min-h-50 w-full resize-y border-none bg-transparent text-[13px] leading-[1.7] text-slate-700 outline-none placeholder:text-slate-400"
            />

            {blankTokens.length > 0 && (
              <div className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-2.75 py-1.75 text-[11px] leading-relaxed text-amber-800">
                {blankTokens.length === 1 ? "This variable has" : "These variables have"} no value
                for {person.firstName} and will send as blank:{" "}
                <span className="font-mono">{blankTokens.join(", ")}</span>. Add a fallback like{" "}
                <span className="font-mono">{`{{${blankTokens[0]}|—}}`}</span> if that reads badly.
              </div>
            )}

            {attachments.length > 0 && (
              <div className="mt-2.5 flex flex-wrap gap-2">
                {attachments.map((file, index) => (
                  <span
                    key={`${file.name}-${index}`}
                    className="inline-flex h-7.5 items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 py-0 pl-2.5 pr-1.5"
                  >
                    <span className="text-slate-400">
                      <FileIcon />
                    </span>
                    <span className="text-xs text-slate-700">{file.name}</span>
                    <span className="text-[11px] text-slate-400">{formatFileSize(file.size)}</span>
                    <button
                      type="button"
                      onClick={() => setAttachments(attachments.filter((_, i) => i !== index))}
                      aria-label={`Remove ${file.name}`}
                      className="flex h-5 w-5 items-center justify-center rounded-[5px] text-slate-400 transition-colors hover:bg-slate-200"
                    >
                      <CloseIcon size={11} />
                    </button>
                  </span>
                ))}
              </div>
            )}

            {schedule.scheduled && (
              <div className="mt-2.5">
                <ScheduleSendPicker
                  id="schedule-at"
                  value={schedule.scheduleAt ?? ""}
                  onChange={schedule.setScheduleAt}
                />
              </div>
            )}
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-1.5 border-t border-slate-200 px-4 py-3">
          <Button
            variant="primary"
            leadingIcon={isSending ? undefined : <SendIcon />}
            loading={isSending}
            onClick={submit}
            className="h-9 rounded-lg px-4.5"
          >
            {isSending ? "Sending…" : schedule.scheduled ? "Schedule send" : "Send"}
          </Button>

          <ScheduleSendToggle scheduled={schedule.scheduled} onToggle={schedule.toggle} />

          <div className="flex-1" />

          <input
            ref={fileInputRef}
            type="file"
            multiple
            className="hidden"
            onChange={(e) => {
              addFiles(e.target.files);
              e.target.value = "";
            }}
          />
          <Tooltip label="Attach file">
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              aria-label="Attach file"
              className="flex h-9 w-9 items-center justify-center rounded-lg text-slate-600 transition-colors hover:bg-slate-100"
            >
              <AttachIcon />
            </button>
          </Tooltip>

          <div className="relative">
            <Tooltip label="Insert template">
              <button
                ref={templatesButtonRef}
                type="button"
                onClick={() => setTemplatesOpen((open) => !open)}
                aria-label="Insert template"
                aria-expanded={templatesOpen}
                className="flex h-9 w-9 items-center justify-center rounded-lg text-slate-600 transition-colors hover:bg-slate-100"
              >
                <TemplateIcon />
              </button>
            </Tooltip>
            <FloatingMenu
              open={templatesOpen}
              onClose={() => setTemplatesOpen(false)}
              anchorRef={templatesButtonRef}
              align="end"
            >
              <div className="max-h-70 w-60 overflow-y-auto rounded-[9px] border border-slate-200 bg-white p-1.25 shadow-popover">
                <div className="px-2.25 pb-1 pt-1.5 font-mono text-[10px] tracking-[0.08em] text-slate-400">
                  INSERT TEMPLATE
                </div>
                {templatesQuery.isLoading && (
                  <div className="px-2.25 py-2 text-xs text-slate-400">Loading…</div>
                )}
                {templatesQuery.isError && (
                  <div className="px-2.25 py-2 text-xs text-red-600">
                    Couldn’t load your templates.
                  </div>
                )}
                {!templatesQuery.isLoading && !templatesQuery.isError && templates.length === 0 && (
                  <Link
                    href="/templates"
                    className="block rounded-md px-2.25 py-1.75 text-[13px] text-accent-11 hover:bg-slate-100"
                  >
                    No templates yet — create one
                  </Link>
                )}
                {templates.map((template) => (
                  <button
                    key={template.id}
                    type="button"
                    onClick={() => applyTemplate(template.subject, template.body)}
                    className="block w-full rounded-md px-2.25 py-1.75 text-left text-[13px] text-slate-700 transition-colors hover:bg-slate-100"
                  >
                    {template.name}
                  </button>
                ))}
              </div>
            </FloatingMenu>
          </div>
        </div>
      </div>

      <div className="pointer-events-none absolute bottom-3 left-1/2 -translate-x-1/2 text-[11px] text-slate-400">
        Preview subject: {resolveMergeVariables(subject, mergeContext) || "—"}
      </div>
    </div>
  );
}
