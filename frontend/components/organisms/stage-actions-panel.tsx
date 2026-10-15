"use client";

import { useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import {
  AlarmClock,
  ArrowRight,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Clock,
  FileText,
  Mail,
  X,
} from "lucide-react";

import { cn } from "@/utilities/cn";
import { Button } from "@/components/atoms/button";
import { PlusIcon } from "@/components/atoms/icons";
import { FloatingMenu } from "@/components/molecules/floating-menu";
import { usePosition } from "@/hooks/use-positions";
import { useMessageTemplates } from "@/hooks/use-message-templates";
import { useQuestionnaires } from "@/hooks/use-questionnaires";
import {
  useCreateStageAction,
  useDeleteStageAction,
  useStageActions,
  useUpdateStageAction,
} from "@/hooks/use-stage-actions";
import { reminderScheduleDays } from "@/utilities/reminder-plan";
import {
  DEFAULT_REMINDER,
  DELAY_UNITS,
  delayMinutesFrom,
  draftFrom,
  draftProblem,
  newDraft,
  reminderConfigWithIntervalDays,
  reminderConfigWithMaxCount,
  reminderIntervalDays,
  splitDelay,
  type DelayUnit,
  type StageActionDraft,
} from "@/utilities/stage-action-form";
import type {
  MessageTemplate,
  PipelineStage,
  QuestionnaireTemplate,
  ReminderConfig,
  StageAction,
  StageActionInput,
  StageActionType,
} from "@/types/api";

type Mode = "list" | "picker" | "config";

const STOP_CONDITIONS = [
  "The candidate completes it",
  "The candidate moves to another stage",
  "The maximum count is reached",
  "Someone stops reminders by hand",
];

function EmailIcon() {
  return <Mail size={17} aria-hidden="true" />;
}

function QuestionnaireIcon() {
  return <FileText size={17} aria-hidden="true" />;
}

function MoveIcon() {
  return <ArrowRight size={17} aria-hidden="true" />;
}

function ChevronUpMini() {
  return <ChevronUp size={11} aria-hidden="true" />;
}

function ChevronDownMini() {
  return <ChevronDown size={11} aria-hidden="true" />;
}

function CaretDown() {
  return <ChevronDown size={13} aria-hidden="true" />;
}

function XMini({ size = 15 }: { size?: number }) {
  return <X size={size} aria-hidden="true" />;
}

function BackChevron() {
  return <ChevronLeft size={14} aria-hidden="true" />;
}

function CaretRight() {
  return <ChevronRight size={14} aria-hidden="true" />;
}

function BellIcon() {
  return <AlarmClock size={15} className="text-amber-700" aria-hidden="true" />;
}

function CheckMini() {
  return <Check size={10} className="text-white" strokeWidth={2.5} aria-hidden="true" />;
}

type Meta = { label: string; icon: ReactNode; iconBg: string; desc: string };

const META: Record<StageActionType, Meta> = {
  send_email: {
    label: "Send Email",
    icon: <EmailIcon />,
    iconBg: "bg-accent-3 text-accent-11",
    desc: "Send a templated email to the candidate.",
  },
  send_questionnaire: {
    label: "Send Questionnaire",
    icon: <QuestionnaireIcon />,
    iconBg: "bg-violet-50 text-violet-700",
    desc: "Send a reusable questionnaire, with optional reminders.",
  },
  move_to_stage: {
    label: "Move to Stage",
    icon: <MoveIcon />,
    iconBg: "bg-green-50 text-green-700",
    desc: "Automatically move the candidate to another stage.",
  },
};

function Toggle({ on, onClick }: { on: boolean; onClick?: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "relative h-5 w-8 shrink-0 rounded-full transition-colors",
        on ? "bg-accent-9" : "bg-slate-300",
      )}
      aria-pressed={on}
    >
      <span
        className={cn(
          "absolute top-0.5 h-4 w-4 rounded-full bg-white shadow-sm transition-[left]",
          on ? "left-3.5" : "left-0.5",
        )}
      />
    </button>
  );
}

function Segment({
  value,
  options,
  onChange,
}: {
  value: DelayUnit;
  options: readonly DelayUnit[];
  onChange: (value: DelayUnit) => void;
}) {
  return (
    <div className="flex h-8.5 items-center overflow-hidden rounded-md border border-slate-300">
      {options.map((option) => (
        <button
          key={option}
          type="button"
          onClick={() => onChange(option)}
          className={cn(
            "flex h-8.5 items-center border-l border-slate-100 px-2.5 text-xs first:border-l-0",
            option === value ? "bg-slate-900 text-white" : "bg-white text-slate-600",
          )}
        >
          {option}
        </button>
      ))}
    </div>
  );
}

function Dropdown({ children }: { children: ReactNode }) {
  return (
    <div className="max-h-60 overflow-y-auto rounded-lg border border-slate-200 bg-white p-1 shadow-popover">
      {children}
    </div>
  );
}

function DropdownItem({ children, onClick }: { children: ReactNode; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left text-[13px] text-slate-700 hover:bg-slate-100"
    >
      {children}
    </button>
  );
}

const saInput =
  "h-8.5 w-full rounded-md border border-slate-300 bg-white px-2.5 text-[13px] text-slate-900 outline-none";

function Panel({
  title,
  onBack,
  onClose,
  children,
  footer,
}: {
  title: string;
  onBack?: () => void;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <div className="relative h-full overflow-hidden">
      <button
        type="button"
        aria-label="Close stage actions"
        className="absolute inset-0 h-full w-full cursor-default bg-slate-900/30 backdrop-blur-sm"
        onClick={onClose}
      />

      <div className="absolute inset-y-0 right-0 flex w-135 max-w-[96vw] flex-col border-l border-slate-200 bg-white shadow-modal">
        <div className="flex shrink-0 items-center gap-3 border-b border-slate-200 px-4.5 py-4">
          {onBack && (
            <button
              type="button"
              onClick={onBack}
              aria-label="Back"
              className="flex h-7.5 w-7.5 shrink-0 items-center justify-center rounded-md border border-slate-200 text-slate-500 hover:bg-slate-50"
            >
              <BackChevron />
            </button>
          )}
          <div className="min-w-0 flex-1">
            <div className="font-mono text-[11px] uppercase tracking-wider text-slate-400">
              Stage actions
            </div>
            <div className="mt-0.5 truncate text-base font-semibold tracking-tight">{title}</div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex h-7.5 w-7.5 shrink-0 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100"
          >
            <XMini />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>

        {footer && (
          <div className="flex h-15 shrink-0 items-center gap-2.5 border-t border-slate-200 px-4.5">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}

function Notice({ title, body, action }: { title: string; body: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center px-5 py-16 text-center">
      <div className="mb-1.5 text-sm font-semibold text-slate-900">{title}</div>
      <div className="mb-4 max-w-70 text-xs leading-relaxed text-slate-500">{body}</div>
      {action}
    </div>
  );
}

function delayText(minutes: number): string {
  if (minutes === 0) return "Immediately";
  const { value, unit } = splitDelay(minutes);
  return `After ${value} ${unit}`;
}

function summaryOf(
  action: StageAction,
  templates: MessageTemplate[],
  questionnaires: QuestionnaireTemplate[],
  stages: PipelineStage[],
): string {
  if (action.type === "send_email") {
    const template = templates.find((row) => row.id === action.messageTemplateId);
    return `Template: ${template?.name ?? "deleted template"}`;
  }

  if (action.type === "send_questionnaire") {
    const questionnaire = questionnaires.find((row) => row.id === action.questionnaireTemplateId);
    const reminders = action.reminderConfig?.enabled
      ? ` · chased up to ${action.reminderConfig.maxCount} times`
      : "";
    return `Questionnaire: ${questionnaire?.name ?? "deleted questionnaire"}${reminders}`;
  }

  const stage = stages.find((row) => row.id === action.targetPositionStageId);
  return `Target: ${stage?.name ?? "deleted stage"}`;
}

export type StageActionsPanelProps = {
  positionId: string;
  stageId: string;
  onClose: () => void;
  draftSavedBanner?: boolean;
};

export function StageActionsPanel({
  positionId,
  stageId,
  onClose,
  draftSavedBanner = false,
}: StageActionsPanelProps) {
  const [mode, setMode] = useState<Mode>("list");
  const [draft, setDraft] = useState<StageActionDraft | null>(null);
  const [openSelect, setOpenSelect] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [draftSavedDismissed, setDraftSavedDismissed] = useState(false);
  const draftSaved = draftSavedBanner && !draftSavedDismissed;

  const position = usePosition(positionId);
  const actions = useStageActions(stageId);
  const templates = useMessageTemplates();
  const questionnaires = useQuestionnaires();

  const createAction = useCreateStageAction(stageId);
  const updateAction = useUpdateStageAction(stageId);
  const deleteAction = useDeleteStageAction(stageId);

  const close = onClose;

  const stages = position.data?.stages ?? [];
  const stage = stages.find((row) => row.id === stageId) ?? null;
  const rows = actions.data ?? [];
  const busy = createAction.isPending || updateAction.isPending || deleteAction.isPending;

  function backToList() {
    setMode("list");
    setDraft(null);
    setOpenSelect(null);
    setProblem(null);
  }

  function chooseType(type: StageActionType) {
    setDraft(newDraft(type));
    setOpenSelect(null);
    setProblem(null);
    setMode("config");
  }

  function editAction(action: StageAction) {
    setDraft(draftFrom(action));
    setOpenSelect(null);
    setProblem(null);
    setMode("config");
  }

  async function reorder(index: number, direction: -1 | 1) {
    const target = index + direction;
    const moved = rows[index];
    const displaced = rows[target];
    if (!moved || !displaced) return;

    const next = [...rows];
    next[index] = displaced;
    next[target] = moved;

    try {
      await Promise.all(
        next
          .map((action, position) => ({ action, position }))
          .filter(({ action, position }) => action.sortOrder !== position)
          .map(({ action, position }) =>
            updateAction.mutateAsync({ id: action.id, input: { sortOrder: position } }),
          ),
      );
    } catch {
      setProblem("That reorder could not be saved");
    }
  }

  function updateInput(current: StageActionDraft, delayMinutes: number) {
    if (current.type === "send_email") {
      return { delayMinutes, messageTemplateId: current.messageTemplateId ?? undefined };
    }
    if (current.type === "send_questionnaire") {
      return {
        delayMinutes,
        questionnaireTemplateId: current.questionnaireTemplateId ?? undefined,
        reminderConfig: current.reminderConfig,
      };
    }
    return { delayMinutes, targetPositionStageId: current.targetPositionStageId ?? undefined };
  }

  async function save() {
    if (!draft || !stageId) return;

    const invalid = draftProblem(draft);
    if (invalid) {
      setProblem(invalid);
      return;
    }

    const delayMinutes = delayMinutesFrom(draft.delayValue, draft.delayUnit) ?? 0;
    setProblem(null);

    try {
      if (draft.id) {
        await updateAction.mutateAsync({ id: draft.id, input: updateInput(draft, delayMinutes) });
      } else {
        const input: StageActionInput = {
          positionStageId: stageId,
          type: draft.type,
          enabled: draft.enabled,
          delayMinutes,
          sortOrder: rows.length,
          messageTemplateId: draft.messageTemplateId,
          questionnaireTemplateId: draft.questionnaireTemplateId,
          targetPositionStageId: draft.targetPositionStageId,
          reminderConfig: draft.type === "send_questionnaire" ? draft.reminderConfig : null,
        };
        await createAction.mutateAsync(input);
      }
      backToList();
    } catch (error) {
      setProblem(error instanceof Error ? error.message : "That action could not be saved");
    }
  }

  if (position.isLoading || actions.isLoading) {
    return (
      <Panel title="Loading" onClose={close}>
        <div className="flex flex-col gap-2.5 p-4.5">
          <div className="h-16 animate-pulse rounded-xl bg-slate-100" />
          <div className="h-16 animate-pulse rounded-xl bg-slate-100" />
        </div>
      </Panel>
    );
  }

  if (position.isError || actions.isError) {
    return (
      <Panel title="Something went wrong" onClose={close}>
        <Notice
          title="These stage actions could not be loaded"
          body="The position or its stage actions did not come back."
          action={
            <Button
              variant="secondary"
              className="h-9 rounded-lg"
              loading={position.isFetching || actions.isFetching}
              onClick={() => {
                void position.refetch();
                void actions.refetch();
              }}
            >
              Try again
            </Button>
          }
        />
      </Panel>
    );
  }

  if (!stage) {
    return (
      <Panel title="Stage not found" onClose={close}>
        <Notice
          title="That stage is not on this position"
          body="It may have been removed, or the link may be out of date."
          action={
            <Link
              href={`/positions/${positionId}/board`}
              className="text-[13px] font-medium text-accent-11 hover:underline"
            >
              Back to the board
            </Link>
          }
        />
      </Panel>
    );
  }

  const title =
    mode === "list"
      ? stage.name
      : mode === "picker"
        ? "Add action"
        : draft
          ? META[draft.type].label
          : "";

  return (
    <Panel
      title={title}
      onBack={mode === "list" ? undefined : backToList}
      onClose={close}
      footer={
        mode === "config" && draft ? (
          <>
            <Button variant="secondary" className="h-9 rounded-lg" onClick={backToList}>
              Cancel
            </Button>
            <div className="flex-1" />
            <Button
              variant="primary"
              className="h-9 rounded-lg px-4.5"
              disabled={busy}
              loading={createAction.isPending || updateAction.isPending}
              onClick={() => void save()}
            >
              {draft.id ? "Save action" : "Add action"}
            </Button>
          </>
        ) : undefined
      }
    >
      {draftSaved && (
        <div
          role="status"
          className="flex items-center justify-between gap-3 border-b border-green-100 bg-green-50 px-4.5 py-2.5 text-xs text-green-800"
        >
          <span>Draft saved — pick up the rest of the position from Positions anytime.</span>
          <button
            type="button"
            onClick={() => setDraftSavedDismissed(true)}
            aria-label="Dismiss"
            className="shrink-0 text-green-700 hover:text-green-900"
          >
            <XMini size={12} />
          </button>
        </div>
      )}

      {problem && (
        <div
          role="alert"
          className="border-b border-red-100 bg-red-50 px-4.5 py-2.5 text-xs text-red-700"
        >
          {problem}
        </div>
      )}

      {mode === "list" && (
        <ListMode
          stageName={stage.name}
          actions={rows}
          templates={templates.data ?? []}
          questionnaires={questionnaires.data ?? []}
          stages={stages}
          busy={busy}
          onToggle={(action) =>
            void updateAction.mutateAsync({ id: action.id, input: { enabled: !action.enabled } })
          }
          onRemove={(action) => void deleteAction.mutateAsync(action.id)}
          onEdit={editAction}
          onMove={(index, direction) => void reorder(index, direction)}
          onAdd={() => {
            setMode("picker");
            setProblem(null);
          }}
        />
      )}

      {mode === "picker" && <PickerMode onSelect={chooseType} />}

      {mode === "config" && draft && (
        <ConfigForm
          draft={draft}
          stageName={stage.name}
          stages={stages}
          templates={templates.data ?? []}
          questionnaires={questionnaires.data ?? []}
          openSelect={openSelect}
          onToggleSelect={(key) => setOpenSelect((current) => (current === key ? null : key))}
          onCloseSelect={() => setOpenSelect(null)}
          onPatch={(patch) => setDraft((current) => (current ? { ...current, ...patch } : current))}
        />
      )}
    </Panel>
  );
}

function ListMode({
  stageName,
  actions,
  templates,
  questionnaires,
  stages,
  busy,
  onToggle,
  onRemove,
  onEdit,
  onMove,
  onAdd,
}: {
  stageName: string;
  actions: StageAction[];
  templates: MessageTemplate[];
  questionnaires: QuestionnaireTemplate[];
  stages: PipelineStage[];
  busy: boolean;
  onToggle: (action: StageAction) => void;
  onRemove: (action: StageAction) => void;
  onEdit: (action: StageAction) => void;
  onMove: (index: number, direction: -1 | 1) => void;
  onAdd: () => void;
}) {
  return (
    <div className="p-4.5">
      <div className="mb-4 text-xs leading-relaxed text-slate-500">
        These run the first time a candidate enters <strong>{stageName}</strong>, each on its own
        delay. Anything still pending is cancelled if they leave before it fires.
      </div>

      {actions.length === 0 && (
        <div className="flex flex-col items-center rounded-xl border border-dashed border-slate-300 px-5 py-10 text-center">
          <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-xl bg-accent-3 text-accent-9">
            <Clock size={20} aria-hidden="true" />
          </div>
          <div className="mb-1.5 text-sm font-semibold">No actions yet</div>
          <div className="mb-4 max-w-70 text-xs leading-relaxed text-slate-500">
            Add an automated action to run when candidates reach this stage.
          </div>
        </div>
      )}

      <div className="flex flex-col gap-2.5">
        {actions.map((action, index) => {
          const meta = META[action.type];
          const first = index === 0;
          const last = index === actions.length - 1;

          return (
            <div
              key={action.id}
              className="overflow-hidden rounded-xl border border-slate-200 bg-white"
            >
              <div className="flex items-start gap-3 px-3.5 py-3">
                <div className="flex shrink-0 flex-col gap-px pt-0.5">
                  <button
                    type="button"
                    onClick={() => onMove(index, -1)}
                    disabled={first || busy}
                    aria-label="Move earlier"
                    className={cn(
                      "flex h-3.5 w-5 items-center justify-center rounded",
                      first ? "cursor-default text-slate-200" : "text-slate-400 hover:bg-slate-100",
                    )}
                  >
                    <ChevronUpMini />
                  </button>
                  <button
                    type="button"
                    onClick={() => onMove(index, 1)}
                    disabled={last || busy}
                    aria-label="Move later"
                    className={cn(
                      "flex h-3.5 w-5 items-center justify-center rounded",
                      last ? "cursor-default text-slate-200" : "text-slate-400 hover:bg-slate-100",
                    )}
                  >
                    <ChevronDownMini />
                  </button>
                </div>

                <div
                  className={cn(
                    "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg",
                    meta.iconBg,
                  )}
                >
                  {meta.icon}
                </div>

                <button
                  type="button"
                  onClick={() => onEdit(action)}
                  className="min-w-0 flex-1 text-left"
                >
                  <div className="flex items-center gap-2">
                    <span className="text-[13px] font-semibold text-slate-900">{meta.label}</span>
                    <span className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[10px] text-slate-500">
                      {delayText(action.delayMinutes)}
                    </span>
                  </div>
                  <div className="mt-0.5 text-xs leading-snug text-slate-500">
                    {summaryOf(action, templates, questionnaires, stages)}
                  </div>
                </button>

                <div className="flex shrink-0 items-center gap-1">
                  <Toggle on={action.enabled} onClick={() => onToggle(action)} />
                  <button
                    type="button"
                    onClick={() => onRemove(action)}
                    disabled={busy}
                    aria-label="Remove action"
                    className="flex h-7 w-7 items-center justify-center rounded-md text-slate-400 hover:bg-red-50 hover:text-red-600 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent"
                  >
                    <XMini size={13} />
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <button
        type="button"
        onClick={onAdd}
        className="mt-3 inline-flex h-9 items-center gap-1.5 rounded-lg border border-dashed border-slate-300 px-3.5 text-[13px] font-medium text-accent-11 hover:border-slate-400 hover:bg-slate-50"
      >
        <PlusIcon size={14} />
        Add action
      </button>
    </div>
  );
}

function PickerMode({ onSelect }: { onSelect: (type: StageActionType) => void }) {
  const types: StageActionType[] = ["send_email", "send_questionnaire", "move_to_stage"];

  return (
    <div className="p-4.5">
      <div className="mb-1 text-[13px] font-semibold">Choose an action type</div>
      <div className="mb-4 text-xs text-slate-500">Three action types are supported.</div>
      <div className="flex flex-col gap-2.5">
        {types.map((type) => {
          const meta = META[type];
          return (
            <button
              key={type}
              type="button"
              onClick={() => onSelect(type)}
              className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white p-3.5 text-left hover:border-accent-9 hover:bg-accent-2"
            >
              <div
                className={cn(
                  "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg",
                  meta.iconBg,
                )}
              >
                {meta.icon}
              </div>
              <div className="flex-1">
                <div className="text-[13px] font-semibold text-slate-900">{meta.label}</div>
                <div className="mt-0.5 text-xs text-slate-500">{meta.desc}</div>
              </div>
              <span className="text-slate-400">
                <CaretRight />
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function SelectField({
  label,
  value,
  placeholder,
  open,
  onToggle,
  onClose,
  children,
}: {
  label: string;
  value: string | null;
  placeholder: string;
  open: boolean;
  onToggle: () => void;
  onClose: () => void;
  children: ReactNode;
}) {
  const triggerRef = useRef<HTMLButtonElement>(null);

  return (
    <div>
      <div className="mb-1.5 text-xs font-medium text-slate-700">{label}</div>
      <button
        ref={triggerRef}
        type="button"
        onClick={onToggle}
        className={cn(saInput, "flex items-center justify-between text-left")}
      >
        <span className={value ? "" : "text-slate-400"}>{value ?? placeholder}</span>
        <span className="text-slate-500">
          <CaretDown />
        </span>
      </button>
      <FloatingMenu open={open} onClose={onClose} anchorRef={triggerRef} matchWidth>
        {children}
      </FloatingMenu>
    </div>
  );
}

function DelayField({
  draft,
  onPatch,
}: {
  draft: StageActionDraft;
  onPatch: (patch: Partial<StageActionDraft>) => void;
}) {
  return (
    <div>
      <label
        className="mb-1.5 block text-xs font-medium text-slate-700"
        htmlFor="stage-action-delay"
      >
        Delay
      </label>
      <div className="flex items-center gap-2">
        <input
          id="stage-action-delay"
          value={draft.delayValue}
          onChange={(event) => onPatch({ delayValue: event.target.value })}
          className={cn(saInput, "w-17")}
        />
        <Segment
          value={draft.delayUnit}
          options={DELAY_UNITS}
          onChange={(unit) => onPatch({ delayUnit: unit })}
        />
        <span className="text-xs text-slate-400">after entering</span>
      </div>
    </div>
  );
}

function ReminderField({
  reminder,
  onChange,
}: {
  reminder: ReminderConfig | null;
  onChange: (next: ReminderConfig | null) => void;
}) {
  const on = reminder?.enabled ?? false;
  const previewDays = on ? reminderScheduleDays(reminder) : [];

  return (
    <div className="overflow-hidden rounded-xl border border-slate-200">
      <div
        className={cn(
          "flex items-center justify-between px-3.5 py-3",
          on ? "bg-amber-50" : "bg-white",
        )}
      >
        <div className="flex items-center gap-2.5">
          <BellIcon />
          <span className="text-[13px] font-medium text-slate-700">Remind if not completed</span>
        </div>
        <Toggle on={on} onClick={() => onChange(on ? null : { ...DEFAULT_REMINDER })} />
      </div>

      {on && reminder && (
        <div className="flex flex-col gap-3.5 border-t border-slate-100 p-3.5">
          <div className="flex items-center gap-2">
            <label className="w-23 text-xs text-slate-500" htmlFor="reminder-interval">
              Every
            </label>
            <input
              id="reminder-interval"
              value={reminderIntervalDays(reminder)}
              onChange={(event) =>
                onChange(reminderConfigWithIntervalDays(reminder, event.target.value))
              }
              className={cn(saInput, "w-15")}
            />
            <span className="text-xs text-slate-500">days after the last one</span>
          </div>

          <div className="flex items-center gap-2">
            <label className="w-23 text-xs text-slate-500" htmlFor="reminder-max">
              Max reminders
            </label>
            <input
              id="reminder-max"
              value={String(reminder.maxCount)}
              onChange={(event) =>
                onChange(reminderConfigWithMaxCount(reminder, event.target.value))
              }
              className={cn(saInput, "w-15")}
            />
            <span className="text-xs text-slate-500">ten at the very most</span>
          </div>

          {previewDays.length > 0 && (
            <div className="rounded-lg bg-slate-50 px-3 py-2.5 text-xs leading-relaxed text-slate-600">
              Counted from the send, this chases on day {previewDays.join(", day ")}, and then
              stops.
            </div>
          )}

          <div>
            <div className="mb-1.5 text-xs text-slate-500">Always stops when</div>
            <div className="flex flex-col gap-1.5">
              {STOP_CONDITIONS.map((condition) => (
                <div key={condition} className="flex items-center gap-2.5">
                  <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded border border-accent-9 bg-accent-9">
                    <CheckMini />
                  </span>
                  <span className="text-xs text-slate-700">{condition}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ConfigForm({
  draft,
  stageName,
  stages,
  templates,
  questionnaires,
  openSelect,
  onToggleSelect,
  onCloseSelect,
  onPatch,
}: {
  draft: StageActionDraft;
  stageName: string;
  stages: PipelineStage[];
  templates: MessageTemplate[];
  questionnaires: QuestionnaireTemplate[];
  openSelect: string | null;
  onToggleSelect: (key: string) => void;
  onCloseSelect: () => void;
  onPatch: (patch: Partial<StageActionDraft>) => void;
}) {
  const meta = META[draft.type];
  const template = templates.find((row) => row.id === draft.messageTemplateId) ?? null;
  const questionnaire =
    questionnaires.find((row) => row.id === draft.questionnaireTemplateId) ?? null;
  const target = stages.find((row) => row.id === draft.targetPositionStageId) ?? null;

  return (
    <div className="flex flex-col gap-4.5 p-4.5">
      <div className="flex items-center gap-2.5">
        <div
          className={cn(
            "flex h-8.5 w-8.5 shrink-0 items-center justify-center rounded-lg",
            meta.iconBg,
          )}
        >
          {meta.icon}
        </div>
        <div>
          <div className="text-sm font-semibold">{meta.label}</div>
          <div className="text-xs text-slate-500">Runs when a candidate enters {stageName}</div>
        </div>
      </div>

      {draft.type === "send_email" && (
        <SelectField
          label="Message template"
          value={template?.name ?? null}
          placeholder={templates.length === 0 ? "No templates yet" : "Choose a template"}
          open={openSelect === "template"}
          onToggle={() => onToggleSelect("template")}
          onClose={onCloseSelect}
        >
          <Dropdown>
            {templates.map((row) => (
              <DropdownItem
                key={row.id}
                onClick={() => {
                  onPatch({ messageTemplateId: row.id });
                  onCloseSelect();
                }}
              >
                {row.name}
              </DropdownItem>
            ))}
          </Dropdown>
        </SelectField>
      )}

      {draft.type === "send_questionnaire" && (
        <SelectField
          label="Questionnaire"
          value={questionnaire?.name ?? null}
          placeholder={questionnaires.length === 0 ? "No questionnaires yet" : "Choose one"}
          open={openSelect === "questionnaire"}
          onToggle={() => onToggleSelect("questionnaire")}
          onClose={onCloseSelect}
        >
          <Dropdown>
            {questionnaires.map((row) => (
              <DropdownItem
                key={row.id}
                onClick={() => {
                  onPatch({ questionnaireTemplateId: row.id });
                  onCloseSelect();
                }}
              >
                {row.name}
              </DropdownItem>
            ))}
          </Dropdown>
        </SelectField>
      )}

      {draft.type === "move_to_stage" && (
        <SelectField
          label="Target stage"
          value={target?.name ?? null}
          placeholder="Choose a stage"
          open={openSelect === "target"}
          onToggle={() => onToggleSelect("target")}
          onClose={onCloseSelect}
        >
          <Dropdown>
            {stages.map((row) => (
              <DropdownItem
                key={row.id}
                onClick={() => {
                  onPatch({ targetPositionStageId: row.id });
                  onCloseSelect();
                }}
              >
                <span className="h-1.5 w-1.5 rounded-full bg-slate-400" />
                {row.name}
              </DropdownItem>
            ))}
          </Dropdown>
        </SelectField>
      )}

      <DelayField draft={draft} onPatch={onPatch} />

      {draft.type === "send_questionnaire" && (
        <ReminderField
          reminder={draft.reminderConfig}
          onChange={(next) => onPatch({ reminderConfig: next })}
        />
      )}
    </div>
  );
}
