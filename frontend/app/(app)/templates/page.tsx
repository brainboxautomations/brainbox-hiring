"use client";

import { useMemo, useRef, useState } from "react";

import { useUnsavedChangesWarning } from "@/hooks/use-unsaved-changes-warning";

import { Button } from "@/components/atoms/button";
import { EditableTitleInput } from "@/components/atoms/editable-title-input";
import { PlusIcon, TrashIcon } from "@/components/atoms/icons";
import { Tooltip } from "@/components/atoms/tooltip";
import { ConfirmDialog } from "@/components/molecules/confirm-dialog";
import { ErrorAlert } from "@/components/molecules/error-alert";
import { MergeVariableMenu } from "@/components/organisms/merge-variable-menu";
import { RichTextEditor, type RichTextEditorHandle } from "@/components/organisms/rich-text-editor";
import {
  useCreateMessageTemplate,
  useDeleteMessageTemplate,
  useMessageTemplates,
  useUpdateMessageTemplate,
} from "@/hooks/use-message-templates";
import type { MessageTemplate } from "@/types/api";
import { apiErrorMessage } from "@/utilities/api-error";
import { initialsFor } from "@/utilities/email-address";
import { buildMergeContext, resolveMergeVariables } from "@/utilities/merge-variables";
import { relativeTime } from "@/utilities/relative-time";
import { richTextToHtml } from "@/utilities/rich-text";
import { ChevronLeft, Copy, Mail } from "lucide-react";

const SAMPLE_SENDER = "Rowan Mills";
const SAMPLE_RECIPIENT = "Amara Okafor";

const SAMPLE_CUSTOM_KEYS = ["notice_period", "years_experience"];

const PREVIEW_CONTEXT = buildMergeContext({
  candidate: {
    firstName: "Amara",
    lastName: "Okafor",
    email: "amara.okafor@example.com",
    phone: "+92 300 1234567",
    customAttributes: { notice_period: "4 weeks", years_experience: "6 years" },
  },
  position: {
    title: "Senior Frontend Engineer",
    department: "Engineering",
    locations: [{ country: "Pakistan", detail: "Karachi" }],
    remoteFlag: true,
    salaryFrom: 150000,
    salaryTo: 250000,
    salaryPeriod: "month",
    salaryCurrency: "PKR",
  },
  company: { name: "Acme Inc.", careersUrl: "https://jobs.example.com/careers" },
  senderName: SAMPLE_SENDER,
});

const NEW_TEMPLATE_BODY =
  "Hi {{candidate.first_name}},\n\n" +
  "Thanks for your interest in the {{position.title}} role at {{company.name}}.\n\n" +
  "Best,\n{{sender.name}}";

type Draft = { id: string | null; name: string; subject: string; body: string };

const BLANK_DRAFT: Draft = {
  id: null,
  name: "Untitled template",
  subject: "",
  body: NEW_TEMPLATE_BODY,
};

function MailCardIcon() {
  return <Mail size={17} aria-hidden="true" />;
}

function DuplicateIcon() {
  return <Copy size={14} aria-hidden="true" />;
}

function BackChevronIcon() {
  return <ChevronLeft size={13} aria-hidden="true" />;
}

export default function TemplatesPage() {
  const { data: templates, isLoading, isError, error, refetch, isFetching } = useMessageTemplates();
  const createTemplate = useCreateMessageTemplate();
  const updateTemplate = useUpdateMessageTemplate();
  const deleteTemplate = useDeleteMessageTemplate();

  const [draft, setDraft] = useState<Draft | null>(null);
  // What the draft looked like when it was opened or last saved. Comparing
  // against it is what makes "are there unsaved changes?" answerable, so
  // leaving the page can warn instead of discarding the work in silence.
  const [savedDraft, setSavedDraft] = useState<Draft | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  const dirty =
    draft !== null && savedDraft !== null && JSON.stringify(draft) !== JSON.stringify(savedDraft);

  useUnsavedChangesWarning(
    dirty,
    "This template has changes you haven't saved yet. Leave and lose them?",
  );
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string } | null>(null);

  function openNew() {
    setSaveError(null);
    setDraft({ ...BLANK_DRAFT });
    setSavedDraft({ ...BLANK_DRAFT });
  }

  function openTemplate(template: MessageTemplate) {
    setSaveError(null);
    const opened = {
      id: template.id,
      name: template.name,
      subject: template.subject,
      body: template.body,
    };
    setDraft(opened);
    setSavedDraft(opened);
  }

  function duplicate(template: MessageTemplate) {
    setSaveError(null);
    const copy = {
      id: null,
      name: `${template.name} copy`,
      subject: template.subject,
      body: template.body,
    };
    setDraft(copy);
    setSavedDraft(copy);
  }

  async function save(next: Draft) {
    setSaveError(null);
    const input = { name: next.name.trim(), subject: next.subject, body: next.body };
    if (!input.name) {
      setSaveError("Give the template a name before saving.");
      return;
    }

    try {
      if (next.id) {
        await updateTemplate.mutateAsync({ id: next.id, input });
      } else {
        const created = await createTemplate.mutateAsync(input);
        setDraft({ ...next, id: created.id });
        setSavedDraft({ ...next, id: created.id });
        return;
      }
      setDraft(null);
      setSavedDraft(null);
    } catch (mutationError) {
      setSaveError(apiErrorMessage(mutationError, "Could not save the template."));
    }
  }

  async function remove(id: string) {
    setSaveError(null);
    try {
      await deleteTemplate.mutateAsync(id);
      setDraft(null);
    } catch (mutationError) {
      setSaveError(apiErrorMessage(mutationError, "Could not delete the template."));
    }
  }

  if (draft) {
    return (
      <>
        <TemplateEditor
          draft={draft}
          saving={createTemplate.isPending || updateTemplate.isPending}
          deleting={deleteTemplate.isPending}
          errorMessage={saveError}
          onChange={setDraft}
          onBack={() => {
            // The nav-link guard cannot see this one: it never navigates, it
            // just unmounts the editor in place.
            if (
              dirty &&
              !window.confirm("This template has changes you haven't saved yet. Discard them?")
            ) {
              return;
            }
            setSaveError(null);
            setDraft(null);
            setSavedDraft(null);
          }}
          onSave={() => save(draft)}
          onDelete={
            draft.id ? () => setDeleteTarget({ id: draft.id as string, name: draft.name }) : null
          }
        />
        <ConfirmDialog
          open={deleteTarget != null}
          title={`Delete "${deleteTarget?.name}"?`}
          description="This message template will be removed and can no longer be used for stage actions or manual sends. This cannot be undone."
          confirmLabel="Delete"
          danger
          loading={deleteTemplate.isPending}
          onCancel={() => setDeleteTarget(null)}
          onConfirm={async () => {
            if (!deleteTarget) return;
            // Close once the delete lands, so the dialog's spinner is seen.
            await remove(deleteTarget.id);
            setDeleteTarget(null);
          }}
        />
      </>
    );
  }

  const rows = templates ?? [];
  const isEmpty = !isLoading && !isError && rows.length === 0;

  return (
    <div className="mx-auto max-w-215 px-8 pb-16 pt-7">
      <div className="mb-4.5 flex items-end justify-between gap-5">
        <div>
          <h1 className="mb-1 text-2xl font-semibold tracking-[-0.02em]">Message templates</h1>
          <p className="text-[13px] text-slate-500">
            Reusable emails for stage actions and manual sends.
          </p>
        </div>
        <Button
          variant="primary"
          leadingIcon={<PlusIcon size={14} />}
          className="h-8.5 rounded-lg"
          onClick={openNew}
        >
          Create template
        </Button>
      </div>

      {saveError && <ErrorAlert title="That didn’t work" message={saveError} className="mb-4" />}

      {isLoading && (
        <div className="flex flex-col gap-2.5">
          {[1, 2, 3, 4].map((row) => (
            <div
              key={row}
              className="flex h-17 items-center gap-3.5 rounded-xl border border-slate-200 bg-white px-4.5"
            >
              <div className="h-9 w-9 animate-[ds-shimmer_1.4s_infinite] rounded-[9px] bg-[linear-gradient(90deg,#F1F5F9_25%,#E2E8F0_37%,#F1F5F9_63%)] bg-[length:400px_100%]" />
              <div className="flex flex-1 flex-col gap-1.75">
                <div className="h-2.5 w-45 animate-[ds-shimmer_1.4s_infinite] rounded bg-[linear-gradient(90deg,#F1F5F9_25%,#E2E8F0_37%,#F1F5F9_63%)] bg-[length:400px_100%]" />
                <div className="h-2 w-60 animate-[ds-shimmer_1.4s_infinite] rounded bg-[linear-gradient(90deg,#F1F5F9_25%,#E2E8F0_37%,#F1F5F9_63%)] bg-[length:400px_100%]" />
              </div>
            </div>
          ))}
        </div>
      )}

      {isError && (
        <div className="flex flex-col items-center rounded-xl border border-red-200 bg-red-50 px-5 py-16 text-center">
          <div className="mb-1.5 text-[15px] font-semibold text-red-800">
            Couldn’t load templates
          </div>
          <div className="mb-4.5 max-w-85 text-[13px] leading-[1.55] text-red-700">
            {error instanceof Error ? error.message : "Something went wrong."}
          </div>
          <Button
            variant="secondary"
            className="h-8.5 rounded-lg"
            loading={isFetching}
            onClick={() => refetch()}
          >
            Try again
          </Button>
        </div>
      )}

      {isEmpty && (
        <div className="flex flex-col items-center rounded-xl border border-slate-200 bg-white px-5 py-16 text-center">
          <div className="mb-4 flex h-11.5 w-11.5 items-center justify-center rounded-xl bg-accent-3 text-accent-9">
            <MailCardIcon />
          </div>
          <div className="mb-1.5 text-[15px] font-semibold">No templates yet</div>
          <div className="mb-4.5 max-w-90 text-[13px] leading-[1.55] text-slate-500">
            Write an email once with merge variables, then reuse it from compose and from Send Email
            stage actions.
          </div>
          <Button
            variant="primary"
            leadingIcon={<PlusIcon size={14} />}
            className="h-8.5 rounded-lg"
            onClick={openNew}
          >
            Create template
          </Button>
        </div>
      )}

      {!isLoading && !isError && rows.length > 0 && (
        <div className="flex flex-col gap-2.5">
          {rows.map((template) => (
            <div
              key={template.id}
              className="flex items-center gap-3.5 rounded-xl border border-slate-200 bg-white px-4.5 py-3.75 shadow-card transition-colors hover:border-slate-300 hover:bg-[#FCFDFE]"
            >
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[9px] bg-accent-3 text-accent-11">
                <MailCardIcon />
              </div>
              <button
                type="button"
                onClick={() => openTemplate(template)}
                className="min-w-0 flex-1 text-left"
              >
                <div className="text-sm font-semibold text-slate-900">{template.name}</div>
                <div className="mt-0.5 truncate text-xs text-slate-500">
                  {resolveMergeVariables(template.subject, PREVIEW_CONTEXT) || "No subject"} ·
                  edited {relativeTime(template.updatedAt)}
                </div>
              </button>
              <div className="flex shrink-0 items-center gap-1">
                <button
                  type="button"
                  onClick={() => openTemplate(template)}
                  className="inline-flex h-7.5 items-center rounded-[7px] border border-slate-300 bg-white px-2.75 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50"
                >
                  Edit
                </button>
                <Tooltip label="Duplicate">
                  <button
                    type="button"
                    aria-label={`Duplicate ${template.name}`}
                    onClick={() => duplicate(template)}
                    className="flex h-7.5 w-7.5 items-center justify-center rounded-[7px] border border-slate-300 bg-white text-slate-600 transition-colors hover:bg-slate-50"
                  >
                    <DuplicateIcon />
                  </button>
                </Tooltip>
                <Tooltip label="Delete">
                  <button
                    type="button"
                    aria-label={`Delete ${template.name}`}
                    onClick={() => setDeleteTarget({ id: template.id, name: template.name })}
                    disabled={deleteTemplate.isPending}
                    className="flex h-7.5 w-7.5 items-center justify-center rounded-[7px] border border-slate-300 bg-white text-slate-500 transition-colors hover:border-red-200 hover:bg-red-50 hover:text-red-600 disabled:opacity-50"
                  >
                    <TrashIcon size={14} />
                  </button>
                </Tooltip>
              </div>
            </div>
          ))}
        </div>
      )}

      <ConfirmDialog
        open={deleteTarget != null}
        title={`Delete "${deleteTarget?.name}"?`}
        description="This message template will be removed and can no longer be used for stage actions or manual sends. This cannot be undone."
        confirmLabel="Delete"
        danger
        loading={deleteTemplate.isPending}
        onCancel={() => setDeleteTarget(null)}
        onConfirm={async () => {
          if (!deleteTarget) return;
          // Close once the delete lands, so the dialog's spinner is seen.
          await remove(deleteTarget.id);
          setDeleteTarget(null);
        }}
      />
    </div>
  );
}

function TemplateEditor({
  draft,
  saving,
  deleting,
  errorMessage,
  onChange,
  onBack,
  onSave,
  onDelete,
}: {
  draft: Draft;
  saving: boolean;
  deleting: boolean;
  errorMessage: string | null;
  onChange: (draft: Draft) => void;
  onBack: () => void;
  onSave: () => void;
  onDelete: (() => void) | null;
}) {
  const [varMenuOpen, setVarMenuOpen] = useState(false);
  const bodyRef = useRef<RichTextEditorHandle>(null);

  const previewSubject = useMemo(
    () => resolveMergeVariables(draft.subject, PREVIEW_CONTEXT),
    [draft.subject],
  );
  const previewHtml = useMemo(
    () => richTextToHtml(resolveMergeVariables(draft.body, PREVIEW_CONTEXT)),
    [draft.body],
  );

  function insertVariable(token: string) {
    // Insert where the user is typing, the way the compose screen does. This
    // used to append to the end of the body regardless of the caret, so a
    // variable dropped into the middle of a paragraph landed after the
    // signature instead.
    bodyRef.current?.insertAtCursor(token);
    setVarMenuOpen(false);
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center gap-3.5 border-b border-slate-200 bg-white px-5 py-3">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-1.5 text-xs text-slate-500 transition-colors hover:text-accent-11"
        >
          <BackChevronIcon />
          Templates
        </button>
        <EditableTitleInput
          value={draft.name}
          onChange={(value) => onChange({ ...draft, name: value })}
          ariaLabel="Template name"
          inputClassName="min-w-65 text-[17px]"
        />
        <div className="flex-1" />
        {onDelete && (
          <Button
            variant="reject"
            className="h-8.5 rounded-lg"
            loading={deleting}
            onClick={onDelete}
          >
            Delete
          </Button>
        )}
        <Button variant="primary" className="h-8.5 rounded-lg" loading={saving} onClick={onSave}>
          Save template
        </Button>
      </div>

      {errorMessage && (
        <div className="shrink-0 px-5 pt-3">
          <ErrorAlert title="That didn’t work" message={errorMessage} />
        </div>
      )}

      <div className="flex min-h-0 flex-1">
        <div className="w-[54%] shrink-0 overflow-y-auto border-r border-slate-200 px-6 py-5.5">
          <label
            htmlFor="template-subject"
            className="mb-1.5 block text-xs font-medium text-slate-700"
          >
            Subject
          </label>
          <input
            id="template-subject"
            value={draft.subject}
            onChange={(e) => onChange({ ...draft, subject: e.target.value })}
            className="mb-5 h-8.5 w-full rounded-[7px] border border-slate-300 bg-white px-2.75 text-[13px] text-slate-900 outline-none transition-shadow focus:border-accent-9 focus:ring-3 focus:ring-accent-9/20"
          />

          <div className="mb-1.5 flex items-center justify-between">
            <span className="text-xs font-medium text-slate-700">Body</span>
            <MergeVariableMenu
              open={varMenuOpen}
              onToggle={() => setVarMenuOpen((open) => !open)}
              onInsert={insertVariable}
              customAttributeKeys={SAMPLE_CUSTOM_KEYS}
            />
          </div>

          <RichTextEditor
            handleRef={bodyRef}
            value={draft.body}
            onChange={(body) => onChange({ ...draft, body })}
            ariaLabel="Body"
          />

          <div className="mt-2 text-[11px] leading-relaxed text-slate-400">
            Merge variables like{" "}
            <span className="font-mono text-slate-500">{"{{candidate.first_name}}"}</span> fill in
            per candidate at send time. A variable with no value resolves to nothing — write{" "}
            <span className="font-mono text-slate-500">{"{{custom.notice_period|soon}}"}</span> to
            give it a fallback.
          </div>
        </div>

        <div className="min-w-0 flex-1 overflow-y-auto bg-slate-100">
          <div className="mx-auto max-w-120 px-5 pb-12 pt-6">
            <div className="mb-3 text-center font-mono text-[11px] tracking-[0.1em] text-slate-400">
              PREVIEW · SAMPLE VALUES
            </div>
            <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-card">
              <div className="border-b border-slate-100 px-4.5 py-3.5">
                <div className="mb-2 flex items-center gap-2.5">
                  <div className="flex h-7.5 w-7.5 items-center justify-center rounded-full bg-accent-3 text-[11px] font-semibold text-accent-11">
                    {initialsFor(SAMPLE_SENDER)}
                  </div>
                  <div>
                    <div className="text-xs font-semibold text-slate-900">{SAMPLE_SENDER}</div>
                    <div className="text-[11px] text-slate-400">
                      via BrainBox · to {SAMPLE_RECIPIENT}
                    </div>
                  </div>
                </div>
                <div className="text-[15px] font-semibold text-slate-900">
                  {previewSubject || "No subject"}
                </div>
              </div>
              <div
                className="email-body p-4.5 text-[13px] leading-[1.7] text-slate-700"
                dangerouslySetInnerHTML={{ __html: previewHtml }}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
