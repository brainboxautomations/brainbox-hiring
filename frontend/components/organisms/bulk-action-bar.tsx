"use client";

import { useState } from "react";

import { cn } from "@/utilities/cn";
import {
  candidateNoun,
  type BulkActionOutcome,
  type BulkActionTone,
} from "@/utilities/bulk-action-outcome";
import { reminderScheduleDays } from "@/utilities/reminder-plan";
import { DEFAULT_REMINDER } from "@/utilities/stage-action-form";
import type { MessageTemplate, PipelineStage, QuestionnaireTemplate } from "@/types/api";
import { CheckboxIndicator } from "@/components/atoms/checkbox";
import { CloseIcon } from "@/components/atoms/icons";
import { Archive, ArrowRight, Download, FileText, Mail, type LucideIcon } from "lucide-react";

export type BulkActionId = "move" | "email" | "questionnaire" | "archive" | "export";

export type BulkActionBarProps = {
  selectedCount: number;
  stages: PipelineStage[];
  messageTemplates: MessageTemplate[];
  questionnaires: QuestionnaireTemplate[];
  pendingAction: BulkActionId | null;
  outcome: BulkActionOutcome | null;
  notice: string | null;
  onMoveToStage: (stageId: string) => void;
  onSendEmail: (messageTemplateId: string) => void;
  onSendQuestionnaire: (questionnaireTemplateId: string, sendReminders: boolean) => void;
  onArchive: () => void;
  onExport: () => void;
  onClearSelection: () => void;
  onDismissOutcome: () => void;
};

/**
 * The pickers open upward from the bar. Capped to the space above it, with the
 * list scrolling inside, so a long template or questionnaire library cannot
 * push its first entries (and the reminders toggle) off the top of the screen.
 */
const PANEL =
  "pointer-events-auto flex max-h-[calc(100dvh-9rem)] flex-col rounded-xl border border-slate-200 bg-white p-1.5 shadow-modal";
const PANEL_LIST = "min-h-0 flex-1 overflow-y-auto";

const REMINDER_DAYS = reminderScheduleDays(DEFAULT_REMINDER);

function reminderScheduleSentence(): string {
  if (REMINDER_DAYS.length === 0) return "No reminders are scheduled.";
  const days = REMINDER_DAYS.map((day) => `day ${day}`).join(", ");
  return `Chase on ${days} until they answer.`;
}

const outcomeStyles: Record<BulkActionTone, string> = {
  success: "border-green-200 bg-green-50 text-green-900",
  partial: "border-amber-200 bg-amber-50 text-amber-900",
  error: "border-red-200 bg-red-50 text-red-900",
};

function Spinner() {
  return (
    <span
      aria-hidden="true"
      className="inline-block h-3.25 w-3.25 animate-[ds-spin_0.7s_linear_infinite] rounded-full border-2 border-slate-500 border-t-white"
    />
  );
}

const ACTION_GLYPH: Record<BulkActionId | "email" | "quest", LucideIcon> = {
  move: ArrowRight,
  email: Mail,
  quest: FileText,
  questionnaire: FileText,
  archive: Archive,
  export: Download,
};

function ActionIcon({ action }: { action: BulkActionId | "email" | "quest" }) {
  const Glyph = ACTION_GLYPH[action];
  return <Glyph size={13} aria-hidden="true" />;
}

const barButtonClass =
  "flex items-center gap-1.5 whitespace-nowrap rounded-md px-2.5 py-1.75 text-xs text-slate-200 hover:bg-slate-800 disabled:cursor-not-allowed disabled:text-slate-500 disabled:hover:bg-transparent";

type BulkPanel = "move" | "email" | "questionnaire" | "archive";

export function BulkActionBar({
  selectedCount,
  stages,
  messageTemplates,
  questionnaires,
  pendingAction,
  outcome,
  notice,
  onMoveToStage,
  onSendEmail,
  onSendQuestionnaire,
  onArchive,
  onExport,
  onClearSelection,
  onDismissOutcome,
}: BulkActionBarProps) {
  const [openPanel, setOpenPanel] = useState<BulkPanel | null>(null);
  const [sendReminders, setSendReminders] = useState(true);

  const isBusy = pendingAction !== null;
  const hasStages = stages.length > 0;
  const hasTemplates = messageTemplates.length > 0;
  const hasQuestionnaires = questionnaires.length > 0;
  const hasSelection = selectedCount > 0;

  const closePanel = () => setOpenPanel(null);

  const togglePanel = (panel: BulkPanel) =>
    setOpenPanel((current) => (current === panel ? null : panel));

  const moveTo = (stageId: string) => {
    closePanel();
    onMoveToStage(stageId);
  };

  const sendEmail = (messageTemplateId: string) => {
    closePanel();
    onSendEmail(messageTemplateId);
  };

  const sendQuestionnaire = (questionnaireTemplateId: string) => {
    closePanel();
    onSendQuestionnaire(questionnaireTemplateId, sendReminders);
  };

  const confirmArchive = () => {
    closePanel();
    onArchive();
  };

  return (
    <div className="pointer-events-none absolute bottom-5 left-1/2 z-40 flex -translate-x-1/2 flex-col items-center gap-2">
      {outcome && (
        <div
          role={outcome.tone === "success" ? "status" : "alert"}
          className={cn(
            "pointer-events-auto w-105 max-w-[90vw] rounded-xl border px-3.5 py-3 shadow-modal",
            outcomeStyles[outcome.tone],
          )}
        >
          <div className="flex items-start gap-2">
            <div className="min-w-0 flex-1">
              <div className="text-[13px] font-semibold">{outcome.title}</div>
              <div className="mt-0.5 text-xs leading-relaxed">{outcome.message}</div>
              {outcome.action && (
                <button
                  type="button"
                  onClick={outcome.action.onClick}
                  disabled={outcome.action.pending}
                  className="mt-2 inline-flex h-7 items-center rounded-md border border-current/30 bg-white/70 px-2.5 text-xs font-medium hover:bg-white disabled:opacity-60"
                >
                  {outcome.action.label}
                </button>
              )}
              {outcome.details.length > 0 && (
                <ul className="mt-1.5 flex max-h-28 flex-col gap-0.5 overflow-y-auto text-xs leading-relaxed">
                  {outcome.details.map((detail) => (
                    <li key={detail}>{detail}</li>
                  ))}
                </ul>
              )}
            </div>
            <button
              type="button"
              onClick={onDismissOutcome}
              aria-label="Dismiss"
              className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md hover:bg-black/5"
            >
              <CloseIcon size={13} />
            </button>
          </div>
        </div>
      )}

      {notice && (
        <div
          role="status"
          className="pointer-events-auto w-105 max-w-[90vw] rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-2.5 text-xs leading-relaxed text-amber-900 shadow-modal"
        >
          {notice}
        </div>
      )}

      {openPanel === "move" && (
        <div className={cn(PANEL, "w-70")}>
          <div className="px-2 pb-1 pt-1 text-[11px] font-semibold text-slate-500">
            Move to stage
          </div>
          {hasStages ? (
            <div className={PANEL_LIST}>
              {stages.map((stage) => (
                <button
                  key={stage.id}
                  type="button"
                  onClick={() => moveTo(stage.id)}
                  className="flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-[13px] text-slate-700 hover:bg-slate-100"
                >
                  <span className={cn("h-1.75 w-1.75 shrink-0 rounded-full", "bg-slate-400")} />
                  {stage.name}
                </button>
              ))}
            </div>
          ) : (
            <div className="px-2.5 py-3 text-xs leading-relaxed text-slate-500">
              This position has no stages yet. Assign a pipeline before moving candidates.
            </div>
          )}
        </div>
      )}

      {openPanel === "email" && (
        <div className={cn(PANEL, "w-80")}>
          <div className="px-2 pb-1 pt-1 text-[11px] font-semibold text-slate-500">
            Send a template to {selectedCount} {candidateNoun(selectedCount)}
          </div>
          {hasTemplates ? (
            <>
              <div className={PANEL_LIST}>
                {messageTemplates.map((template) => (
                  <button
                    key={template.id}
                    type="button"
                    onClick={() => sendEmail(template.id)}
                    className="flex w-full flex-col items-start gap-0.5 rounded-md px-2.5 py-2 text-left hover:bg-slate-100"
                  >
                    <span className="text-[13px] text-slate-700">{template.name}</span>
                    <span className="w-full truncate text-[11px] text-slate-400">
                      {template.subject}
                    </span>
                  </button>
                ))}
              </div>
              <div className="px-2.5 pb-1 pt-1.5 text-[11px] leading-relaxed text-slate-400">
                Each candidate receives their own message. Nobody is CC&apos;d.
              </div>
            </>
          ) : (
            <div className="px-2.5 py-3 text-xs leading-relaxed text-slate-500">
              There are no message templates yet. Create one under Templates first.
            </div>
          )}
        </div>
      )}

      {openPanel === "questionnaire" && (
        <div className={cn(PANEL, "w-80")}>
          <div className="px-2 pb-1 pt-1 text-[11px] font-semibold text-slate-500">
            Send a questionnaire to {selectedCount} {candidateNoun(selectedCount)}
          </div>
          {hasQuestionnaires ? (
            <>
              <button
                type="button"
                role="checkbox"
                aria-checked={sendReminders}
                aria-label="Send reminders"
                onClick={() => setSendReminders((value) => !value)}
                className="flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left hover:bg-slate-100"
              >
                <CheckboxIndicator checked={sendReminders} size={15} />
                <span className="min-w-0 flex-1">
                  <span className="block text-[13px] text-slate-700">Send reminders</span>
                  <span className="block text-[11px] leading-relaxed text-slate-400">
                    {reminderScheduleSentence()}
                  </span>
                </span>
              </button>
              <div className="my-1 h-px shrink-0 bg-slate-100" />
              <div className={PANEL_LIST}>
                {questionnaires.map((questionnaire) => (
                  <button
                    key={questionnaire.id}
                    type="button"
                    onClick={() => sendQuestionnaire(questionnaire.id)}
                    className="flex w-full flex-col items-start gap-0.5 rounded-md px-2.5 py-2 text-left hover:bg-slate-100"
                  >
                    <span className="text-[13px] text-slate-700">{questionnaire.name}</span>
                    <span className="w-full truncate text-[11px] text-slate-400">
                      {questionnaire.questionCount}{" "}
                      {questionnaire.questionCount === 1 ? "question" : "questions"}
                    </span>
                  </button>
                ))}
              </div>
              <div className="px-2.5 pb-1 pt-1.5 text-[11px] leading-relaxed text-slate-400">
                Every candidate gets their own link, which only they can open. Anyone who already
                has this questionnaire open receives a fresh link; anyone who has already completed
                it is skipped.
              </div>
            </>
          ) : (
            <div className="px-2.5 py-3 text-xs leading-relaxed text-slate-500">
              There are no questionnaires yet. Build one under Questionnaires first.
            </div>
          )}
        </div>
      )}

      {openPanel === "archive" && (
        <div className="pointer-events-auto w-85 rounded-xl border border-amber-200 bg-amber-50 p-4 shadow-modal">
          <div className="text-sm font-semibold text-amber-800">
            Archive {selectedCount} {candidateNoun(selectedCount)}?
          </div>
          <div className="mt-0.5 text-[13px] leading-relaxed text-amber-700">
            They&apos;ll be removed from the active board but stay searchable with &quot;Include
            archived&quot; on. This won&apos;t send any email.
          </div>
          <div className="mt-3 flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={closePanel}
              className="flex h-8 items-center rounded-md border border-slate-300 bg-white px-3 text-[13px] font-medium text-slate-700 hover:bg-slate-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={confirmArchive}
              className="flex h-8 items-center rounded-md bg-red-600 px-3 text-[13px] font-medium text-white hover:bg-red-700"
            >
              Archive {selectedCount}
            </button>
          </div>
        </div>
      )}

      {hasSelection && (
        <div className="pointer-events-auto flex h-11 items-center gap-0.5 rounded-xl bg-slate-900 pl-3.75 pr-1.75 shadow-bulk">
          <span className="mr-1.5 whitespace-nowrap text-xs font-semibold text-white">
            {selectedCount} selected
          </span>

          <button
            type="button"
            disabled={isBusy || !hasStages}
            onClick={() => togglePanel("move")}
            className={barButtonClass}
          >
            {pendingAction === "move" ? <Spinner /> : <ActionIcon action="move" />}
            Move stage
          </button>

          <button
            type="button"
            disabled={isBusy}
            onClick={() => togglePanel("email")}
            className={barButtonClass}
          >
            {pendingAction === "email" ? <Spinner /> : <ActionIcon action="email" />}
            Send email
          </button>

          <button
            type="button"
            disabled={isBusy}
            onClick={() => togglePanel("questionnaire")}
            className={barButtonClass}
          >
            {pendingAction === "questionnaire" ? <Spinner /> : <ActionIcon action="quest" />}
            Send questionnaire
          </button>

          <button
            type="button"
            disabled={isBusy}
            onClick={() => togglePanel("archive")}
            className={barButtonClass}
          >
            {pendingAction === "archive" ? <Spinner /> : <ActionIcon action="archive" />}
            Archive
          </button>

          <button
            type="button"
            disabled={isBusy}
            onClick={() => {
              closePanel();
              onExport();
            }}
            className={barButtonClass}
          >
            {pendingAction === "export" ? <Spinner /> : <ActionIcon action="export" />}
            Export
          </button>

          <span className="mx-1 h-5 w-px bg-slate-700" />

          <button
            type="button"
            onClick={() => {
              closePanel();
              onClearSelection();
            }}
            className="flex h-7.5 w-7.5 items-center justify-center rounded-md text-slate-400 hover:bg-slate-800 hover:text-slate-200"
            aria-label="Clear selection"
          >
            <CloseIcon size={13} />
          </button>
        </div>
      )}
    </div>
  );
}
