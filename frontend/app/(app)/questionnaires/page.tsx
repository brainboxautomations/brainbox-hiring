"use client";

import { useMemo, useRef, useState } from "react";
import {
  AlignLeft,
  ArrowRight,
  Calendar,
  ChevronLeft,
  CircleCheck,
  CircleDot,
  FileText,
  Hash,
  SquareCheck,
  SquareChevronDown,
  Text,
  Trash2,
  Upload,
  Video,
  type LucideIcon,
} from "lucide-react";

import { cn } from "@/utilities/cn";
import { Button } from "@/components/atoms/button";
import { EditableTitleInput } from "@/components/atoms/editable-title-input";
import { Tooltip } from "@/components/atoms/tooltip";
import {
  ChevronDownIcon,
  CloseIcon,
  GripIcon,
  PlusIcon,
  SearchIcon,
} from "@/components/atoms/icons";
import { ConfirmDialog } from "@/components/molecules/confirm-dialog";
import { FloatingMenu } from "@/components/molecules/floating-menu";
import {
  useQuestionnaires,
  useCreateQuestionnaire,
  useUpdateQuestionnaire,
  useDeleteQuestionnaire,
} from "@/hooks/use-questionnaires";
import { usePipelines } from "@/hooks/use-pipelines";
import { QuestionnairesListSkeleton } from "@/components/molecules/questionnaires-list-skeleton";
import {
  toBuilderQuestion,
  toQuestionInput,
  type BuilderQOption as QOption,
  type BuilderQType as QType,
  type BuilderQuestion as Question,
} from "@/utilities/questionnaire-builder";
import type { QuestionnaireEmailChoice, QuestionnaireTemplate } from "@/types/api";
import { QuestionnaireEmailsPanel } from "@/components/organisms/questionnaire-emails-panel";
import { RichTextEditor } from "@/components/organisms/rich-text-editor";
import { RichTextView } from "@/components/molecules/rich-text-view";

const TYPE_LABELS: Record<QType, string> = {
  short: "Short answer",
  long: "Long answer",
  single: "Single choice",
  multiple: "Multiple choice",
  dropdown: "Dropdown",
  numeric: "Numeric",
  video: "Video",
  file: "File upload",
  date: "Date",
  yesno: "Yes / No",
};

const TYPE_ORDER: QType[] = [
  "short",
  "long",
  "single",
  "multiple",
  "dropdown",
  "numeric",
  "video",
  "file",
  "date",
  "yesno",
];

const MINIMAL_NOTE: Partial<Record<QType, string>> = {
  long: "Candidates get a multi-line text box.",
  file: "Candidates upload a single file (PDF, doc, or zip).",
  date: "Candidates pick a date.",
  yesno: "Candidates choose Yes or No.",
};

const CHOICE_TYPES: QType[] = ["single", "multiple", "dropdown"];
const isChoice = (t: QType) => CHOICE_TYPES.includes(t);

type RouteChoice = { label: string; value: string; dot: string };

const qbIn =
  "h-8 w-full rounded-[7px] border border-slate-300 bg-white px-2.5 text-[13px] text-slate-900 outline-none focus:border-accent-9";

const TYPE_GLYPH: Record<QType, LucideIcon> = {
  short: Text,
  long: AlignLeft,
  single: CircleDot,
  multiple: SquareCheck,
  dropdown: SquareChevronDown,
  numeric: Hash,
  video: Video,
  file: Upload,
  date: Calendar,
  yesno: CircleCheck,
};

function TypeIcon({ type, size = 14 }: { type: QType; size?: number }) {
  const Glyph = TYPE_GLYPH[type] ?? Text;
  return <Glyph size={size} aria-hidden="true" />;
}

function Switch({ on }: { on: boolean }) {
  return (
    <span
      className={cn(
        "relative h-4.75 w-8 shrink-0 rounded-full transition-colors",
        on ? "bg-accent-9" : "bg-slate-300",
      )}
    >
      <span
        className="absolute top-0.5 h-3.75 w-3.75 rounded-full bg-white shadow-[0_1px_2px_rgba(15,23,42,0.2)] transition-all"
        style={{ left: on ? 15 : 2 }}
      />
    </span>
  );
}

function DocIcon({ size = 17 }: { size?: number }) {
  return <FileText size={size} aria-hidden="true" />;
}

function RouteArrow({ color = "currentColor" }: { color?: string }) {
  return <ArrowRight size={12} color={color} aria-hidden="true" />;
}

const DEFAULT_EMAIL_CHOICE: QuestionnaireEmailChoice = {
  mode: "default",
  subject: null,
  body: null,
};

export default function QuestionnairesPage() {
  const { data: library, isLoading } = useQuestionnaires();
  const createQuestionnaire = useCreateQuestionnaire();
  const updateQuestionnaire = useUpdateQuestionnaire();
  const deleteQuestionnaire = useDeleteQuestionnaire();
  const pipelines = usePipelines();

  const [view, setView] = useState<"library" | "builder">("library");
  const [search, setSearch] = useState("");

  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState("Untitled questionnaire");
  const [questions, setQuestions] = useState<Question[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [seq, setSeq] = useState(100);
  const [saveError, setSaveError] = useState<string | null>(null);

  const [addMenuOpen, setAddMenuOpen] = useState(false);
  const [routeOpen, setRouteOpen] = useState<string | null>(null);
  const [completionOpen, setCompletionOpen] = useState(false);
  const [completionStageId, setCompletionStageId] = useState<string | null>(null);
  const [inviteEmail, setInviteEmail] = useState<QuestionnaireEmailChoice>(DEFAULT_EMAIL_CHOICE);
  const [reminderEmail, setReminderEmail] =
    useState<QuestionnaireEmailChoice>(DEFAULT_EMAIL_CHOICE);

  const addMenuAnchorRef = useRef<HTMLButtonElement>(null);
  const routeAnchorRef = useRef<HTMLButtonElement>(null);
  const completionAnchorRef = useRef<HTMLButtonElement>(null);

  const [dragId, setDragId] = useState<number | null>(null);
  const [dropIndex, setDropIndex] = useState<number | null>(null);

  const [deleteTarget, setDeleteTarget] = useState<QuestionnaireTemplate | null>(null);

  const saving = createQuestionnaire.isPending || updateQuestionnaire.isPending;

  const templateStages = useMemo<RouteChoice[]>(
    () =>
      (pipelines.data ?? []).flatMap((pipeline) =>
        pipeline.stages.map((stage) => ({
          label: `${pipeline.name} · ${stage.name}`,
          value: stage.id,
          dot: "#94A3B8",
        })),
      ),
    [pipelines.data],
  );

  const routeChoices: RouteChoice[] = [
    { label: "No routing", value: "", dot: "#CBD5E1" },
    ...templateStages,
  ];

  const completionChoices: RouteChoice[] = [
    { label: "No move", value: "", dot: "#CBD5E1" },
    ...templateStages,
  ];

  const stageLabel = (id: string | null) =>
    id ? (templateStages.find((choice) => choice.value === id)?.label ?? "Deleted stage") : null;

  const startNew = () => {
    setEditingId(null);
    setName("Untitled questionnaire");
    setCompletionStageId(null);
    setInviteEmail(DEFAULT_EMAIL_CHOICE);
    setReminderEmail(DEFAULT_EMAIL_CHOICE);
    setQuestions([]);
    setSelectedId(null);
    setSeq(100);
    setSaveError(null);
    setView("builder");
  };

  const openTemplate = (template: QuestionnaireTemplate) => {
    const loaded = template.questions.map((q, i) => toBuilderQuestion(q, i + 1));
    setEditingId(template.id);
    setName(template.name);
    setCompletionStageId(template.onCompletionTemplateStageId);
    setInviteEmail(template.inviteEmail);
    setReminderEmail(template.reminderEmail);
    setQuestions(loaded);
    setSelectedId(loaded[0]?.id ?? null);
    setSeq(loaded.length + 1);
    setSaveError(null);
    setView("builder");
  };

  const saveQuestionnaire = () => {
    setSaveError(null);
    const input = {
      name: name.trim() || "Untitled questionnaire",
      questions: questions.map(toQuestionInput),
      onCompletionTemplateStageId: completionStageId,
      inviteEmail,
      reminderEmail,
    };
    const onSuccess = () => setView("library");
    const onError = (err: unknown) =>
      setSaveError(err instanceof Error ? err.message : "Could not save the questionnaire.");

    if (editingId) {
      updateQuestionnaire.mutate({ id: editingId, input }, { onSuccess, onError });
    } else {
      createQuestionnaire.mutate(input, { onSuccess, onError });
    }
  };

  const updateQuestion = (id: number, patch: Partial<Question>) =>
    setQuestions((qs) => qs.map((q) => (q.id === id ? { ...q, ...patch } : q)));

  const removeQuestion = (id: number) => setQuestions((qs) => qs.filter((q) => q.id !== id));

  const addQuestion = (type: QType) => {
    const base: Question = {
      id: seq,
      type,
      prompt: "Untitled question",
      help: "",
      required: false,
    };
    if (isChoice(type))
      base.options = [
        { label: "Option 1", route: "" },
        { label: "Option 2", route: "" },
      ];
    if (type === "video") {
      base.videoMax = "1 min";
      base.retakes = true;
    }
    if (type === "numeric") {
      base.numMin = "";
      base.numMax = "";
    }
    setQuestions((qs) => [...qs, base]);
    setSelectedId(seq);
    setSeq((n) => n + 1);
    setAddMenuOpen(false);
  };

  const addOption = (id: number) =>
    setQuestions((qs) =>
      qs.map((q) =>
        q.id === id
          ? { ...q, options: [...(q.options ?? []), { label: "New option", route: "" }] }
          : q,
      ),
    );

  const updateOption = (id: number, oi: number, patch: Partial<QOption>) =>
    setQuestions((qs) =>
      qs.map((q) => {
        if (q.id !== id || !q.options) return q;
        return { ...q, options: q.options.map((o, j) => (j === oi ? { ...o, ...patch } : o)) };
      }),
    );

  const removeOption = (id: number, oi: number) =>
    setQuestions((qs) =>
      qs.map((q) => {
        if (q.id !== id || !q.options) return q;
        return { ...q, options: q.options.filter((_, j) => j !== oi) };
      }),
    );

  const moveDrag = (toIndex: number) => {
    setQuestions((qs) => {
      const from = qs.findIndex((q) => q.id === dragId);
      if (from === -1 || from === toIndex) return qs;
      const arr = [...qs];
      const [moved] = arr.splice(from, 1);
      if (!moved) return qs;
      arr.splice(toIndex > from ? toIndex - 1 : toIndex, 0, moved);
      return arr;
    });
    setDragId(null);
    setDropIndex(null);
  };

  const filteredLibrary = useMemo(
    () =>
      (library ?? []).filter((l) => !search || l.name.toLowerCase().includes(search.toLowerCase())),
    [library, search],
  );

  if (view === "library") {
    return (
      <>
        <div className="h-full overflow-y-auto bg-slate-50">
          <div className="mx-auto max-w-225 px-8 pb-16 pt-7">
            <div className="mb-1.5 flex items-end justify-between gap-5">
              <div>
                <h1 className="mb-1 text-2xl font-semibold tracking-[-0.02em] text-slate-900">
                  Questionnaires
                </h1>
                <p className="text-[13px] text-slate-500">
                  Reusable question sets for application forms and stage actions.
                </p>
              </div>
              <Button
                variant="primary"
                leadingIcon={<PlusIcon size={14} />}
                className="h-8.5 rounded-lg"
                onClick={startNew}
              >
                Create questionnaire
              </Button>
            </div>

            <div className="mb-3.5 mt-4.5 flex items-center gap-2.5">
              <div className="flex h-8.5 w-65 items-center gap-2 rounded-lg border border-slate-300 bg-white px-2.75">
                <SearchIcon size={14} className="shrink-0 text-slate-400" />
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search questionnaires…"
                  className="min-w-0 flex-1 bg-transparent text-[13px] text-slate-900 outline-none placeholder:text-slate-400"
                />
              </div>
              <div className="flex-1" />
            </div>

            {isLoading ? (
              <QuestionnairesListSkeleton />
            ) : filteredLibrary.length === 0 ? (
              <div className="flex flex-col items-center rounded-xl border border-slate-200 bg-white px-5 py-16 text-center">
                <div className="mb-4 flex h-11.5 w-11.5 items-center justify-center rounded-xl bg-accent-3 text-accent-9">
                  <FileText size={22} aria-hidden="true" />
                </div>
                <div className="mb-1.5 text-[15px] font-semibold text-slate-900">
                  {search ? "No matches" : "No questionnaires yet"}
                </div>
                <div className="mb-4.5 max-w-80 text-[13px] leading-[1.55] text-slate-500">
                  {search
                    ? "No questionnaire names match your search."
                    : "Build a reusable questionnaire to attach to application forms or stage actions."}
                </div>
                {!search && (
                  <Button
                    variant="primary"
                    leadingIcon={<PlusIcon size={14} />}
                    className="h-8.5 rounded-lg"
                    onClick={startNew}
                  >
                    Create questionnaire
                  </Button>
                )}
              </div>
            ) : (
              <div className="flex flex-col gap-2.5">
                {filteredLibrary.map((q) => (
                  <div
                    key={q.id}
                    onClick={() => openTemplate(q)}
                    className="flex cursor-pointer items-center gap-3.5 rounded-xl border border-slate-200 bg-white px-4.5 py-3.75 shadow-card hover:border-slate-300 hover:bg-slate-50/40"
                  >
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[9px] bg-accent-3 text-accent-11">
                      <DocIcon />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-semibold text-slate-900">{q.name}</div>
                      <div className="mt-0.5 text-xs text-slate-500">
                        {q.questionCount} {q.questionCount === 1 ? "question" : "questions"}
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          openTemplate(q);
                        }}
                        className="flex h-7.5 items-center rounded-[7px] border border-slate-300 bg-white px-2.75 text-xs font-medium text-slate-700 hover:bg-slate-50"
                      >
                        Edit
                      </button>
                      <Tooltip label="Delete">
                        <button
                          type="button"
                          aria-label="Delete"
                          onClick={(e) => {
                            e.stopPropagation();
                            setDeleteTarget(q);
                          }}
                          className="flex h-7.5 w-7.5 items-center justify-center rounded-[7px] border border-slate-300 bg-white text-slate-500 hover:border-red-200 hover:bg-red-50 hover:text-red-600"
                        >
                          <Trash2 size={14} aria-hidden="true" />
                        </button>
                      </Tooltip>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
        <ConfirmDialog
          open={deleteTarget != null}
          title={`Delete "${deleteTarget?.name}"?`}
          description="This cannot be undone."
          confirmLabel="Delete"
          danger
          loading={deleteQuestionnaire.isPending}
          onCancel={() => setDeleteTarget(null)}
          onConfirm={() => {
            if (!deleteTarget) return;
            // Close once the delete lands, so the dialog's spinner is seen.
            deleteQuestionnaire.mutate(deleteTarget.id, {
              onSettled: () => setDeleteTarget(null),
            });
          }}
        />
      </>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-slate-50">
      <div className="flex shrink-0 items-center gap-3.5 border-b border-slate-200 bg-white px-5 py-3">
        <button
          type="button"
          onClick={() => setView("library")}
          className="inline-flex items-center gap-1.5 text-xs text-slate-500 hover:text-accent-11"
        >
          <ChevronLeft size={13} aria-hidden="true" />
          Library
        </button>
        <EditableTitleInput
          value={name}
          onChange={setName}
          placeholder="Untitled questionnaire"
          ariaLabel="Questionnaire name"
          inputClassName="min-w-65 text-[17px]"
        />
        <span className="text-xs text-slate-400">{questions.length} questions</span>
        <div className="flex-1" />
        {saveError && (
          <span className="max-w-70 truncate text-xs text-red-600" title={saveError}>
            {saveError}
          </span>
        )}
        <Button
          variant="secondary"
          className="h-8.5 rounded-lg"
          disabled={saving}
          onClick={() => setView("library")}
        >
          Cancel
        </Button>
        <Button
          variant="primary"
          className="h-8.5 rounded-lg"
          loading={saving}
          disabled={saving}
          onClick={saveQuestionnaire}
        >
          Save
        </Button>
      </div>

      <div className="flex min-h-0 flex-1">
        <div className="w-[54%] shrink-0 overflow-y-auto border-r border-slate-200 p-5">
          {questions.length === 0 ? (
            <div className="flex flex-col items-center rounded-xl border border-dashed border-slate-300 px-5 py-12 text-center">
              <div className="mb-3.5 flex h-11 w-11 items-center justify-center rounded-[11px] bg-accent-3 text-accent-9">
                <PlusIcon size={20} />
              </div>
              <div className="mb-1.5 text-sm font-semibold text-slate-900">No questions yet</div>
              <div className="max-w-70 text-xs leading-[1.55] text-slate-500">
                Add your first question to start building the form.
              </div>
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              {questions.map((q, i) => {
                const selected = selectedId === q.id;
                const showDrop = dropIndex === i && dragId != null;
                const minimalNote = MINIMAL_NOTE[q.type] ?? "";
                return (
                  <div key={q.id}>
                    {showDrop && <div className="mb-1.5 mt-0.5 h-0.5 rounded-sm bg-accent-9" />}
                    <div
                      draggable
                      onDragStart={() => setDragId(q.id)}
                      onDragEnter={() => {
                        if (dragId != null && dropIndex !== i) setDropIndex(i);
                      }}
                      onDragEnd={() => moveDrag(dropIndex ?? i)}
                      onDragOver={(e) => e.preventDefault()}
                      className={cn(
                        "overflow-hidden rounded-[10px] border bg-white",
                        selected
                          ? "border-[#bdd1ff] shadow-[0_2px_10px_rgba(61,99,221,0.10)]"
                          : "border-slate-200 shadow-card",
                      )}
                    >
                      <div
                        onClick={() => setSelectedId(selected ? null : q.id)}
                        className={cn(
                          "flex cursor-pointer items-center gap-2.5 px-3 py-2.75",
                          selected ? "bg-accent-2" : "bg-white",
                        )}
                      >
                        <span className="shrink-0 cursor-grab text-slate-300">
                          <GripIcon size={14} />
                        </span>
                        <span className="flex h-6.5 w-6.5 shrink-0 items-center justify-center rounded-[7px] bg-slate-100 text-slate-600">
                          <TypeIcon type={q.type} />
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-[13px] font-medium text-slate-900">
                            {q.prompt}
                          </div>
                          <div className="mt-px text-[11px] text-slate-400">
                            {TYPE_LABELS[q.type]}
                          </div>
                        </div>
                        {q.required && (
                          <span className="shrink-0 rounded-[5px] bg-amber-50 px-1.5 py-0.5 font-mono text-[10px] text-amber-700">
                            REQUIRED
                          </span>
                        )}
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            removeQuestion(q.id);
                          }}
                          className="flex h-6.5 w-6.5 shrink-0 items-center justify-center rounded-md text-slate-400 hover:bg-red-50 hover:text-red-600"
                          aria-label="Remove question"
                        >
                          <CloseIcon size={12} />
                        </button>
                      </div>

                      {selected && (
                        <div className="flex flex-col gap-3.5 border-t border-slate-100 px-3 py-3.5">
                          <div>
                            <label className="mb-1.5 block text-[11px] font-medium text-slate-500">
                              Question prompt
                            </label>
                            <input
                              value={q.prompt}
                              onChange={(e) => updateQuestion(q.id, { prompt: e.target.value })}
                              className={qbIn}
                            />
                          </div>
                          <div>
                            <label className="mb-1.5 block text-[11px] font-medium text-slate-500">
                              Help text (optional)
                            </label>
                            <RichTextEditor
                              value={q.help}
                              onChange={(help) => updateQuestion(q.id, { help })}
                              ariaLabel="Help text"
                              placeholder="Shown under the question"
                              minHeightClassName="min-h-16"
                              className="bg-white"
                            />
                          </div>

                          {isChoice(q.type) && (
                            <div>
                              <label className="mb-1.5 block text-[11px] font-medium text-slate-500">
                                Options &amp; answer routing
                              </label>

                              <p className="mb-1.5 text-[11px] leading-relaxed text-slate-500">
                                A routed option moves the candidate when the questionnaire is
                                completed. Where two options both route, the last one wins.
                              </p>
                              <div className="flex flex-col gap-1.5">
                                {(q.options ?? []).map((o, oi) => {
                                  const key = `${q.id}:${oi}`;
                                  const routed = !!o.route;
                                  return (
                                    <div key={oi} className="flex items-center gap-1.75">
                                      <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-slate-300" />
                                      <input
                                        value={o.label}
                                        onChange={(e) =>
                                          updateOption(q.id, oi, { label: e.target.value })
                                        }
                                        className={cn(qbIn, "min-w-0 flex-1")}
                                      />
                                      <div className="shrink-0">
                                        <button
                                          ref={routeOpen === key ? routeAnchorRef : undefined}
                                          type="button"
                                          onClick={() =>
                                            setRouteOpen(routeOpen === key ? null : key)
                                          }
                                          className={cn(
                                            "flex h-8 items-center gap-1.5 rounded-[7px] border px-2.5 hover:bg-slate-50",
                                            routed
                                              ? "border-[#bdd1ff] bg-accent-3"
                                              : "border-slate-200 bg-white",
                                          )}
                                        >
                                          <RouteArrow color={routed ? "#3d63dd" : "#94A3B8"} />
                                          <span
                                            className={cn(
                                              "whitespace-nowrap text-[11px]",
                                              routed ? "text-accent-11" : "text-slate-400",
                                            )}
                                          >
                                            {routed ? stageLabel(o.route) : "No routing"}
                                          </span>
                                        </button>
                                        <FloatingMenu
                                          open={routeOpen === key}
                                          onClose={() => setRouteOpen(null)}
                                          anchorRef={routeAnchorRef}
                                          align="end"
                                        >
                                          <div className="max-h-55 w-50 overflow-y-auto rounded-lg border border-slate-200 bg-white p-1 shadow-popover">
                                            {routeChoices.map((r) => (
                                              <button
                                                key={r.value || "none"}
                                                type="button"
                                                onClick={() => {
                                                  updateOption(q.id, oi, { route: r.value });
                                                  setRouteOpen(null);
                                                }}
                                                className="flex w-full items-center gap-2 rounded-md px-2 py-1.75 text-left text-xs text-slate-700 hover:bg-slate-100"
                                              >
                                                <span
                                                  className="h-1.5 w-1.5 rounded-full"
                                                  style={{ backgroundColor: r.dot }}
                                                />
                                                {r.label}
                                              </button>
                                            ))}
                                          </div>
                                        </FloatingMenu>
                                      </div>
                                      <button
                                        type="button"
                                        onClick={() => removeOption(q.id, oi)}
                                        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-slate-400 hover:bg-red-50 hover:text-red-600"
                                        aria-label="Remove option"
                                      >
                                        <CloseIcon size={12} />
                                      </button>
                                    </div>
                                  );
                                })}
                              </div>
                              <button
                                type="button"
                                onClick={() => addOption(q.id)}
                                className="mt-2 inline-flex items-center gap-1.5 text-xs text-accent-11 hover:underline"
                              >
                                <PlusIcon size={12} />
                                Add option
                              </button>
                              <div className="mt-2 text-[11px] leading-[1.5] text-slate-400">
                                Rules can sit on more than one question. If multiple trigger, the
                                last one wins.
                              </div>
                            </div>
                          )}

                          {q.type === "video" && (
                            <div className="flex items-center gap-5">
                              <div>
                                <label className="mb-1.5 block text-[11px] font-medium text-slate-500">
                                  Max duration
                                </label>
                                <div className="flex h-8 items-center overflow-hidden rounded-[7px] border border-slate-300">
                                  {["30 sec", "1 min", "2 min"].map((d) => (
                                    <button
                                      key={d}
                                      type="button"
                                      onClick={() => updateQuestion(q.id, { videoMax: d })}
                                      className={cn(
                                        "flex h-8 items-center border-l border-slate-100 px-2.75 text-xs first:border-l-0",
                                        q.videoMax === d
                                          ? "bg-slate-900 text-white"
                                          : "bg-white text-slate-500",
                                      )}
                                    >
                                      {d}
                                    </button>
                                  ))}
                                </div>
                              </div>
                              <button
                                type="button"
                                onClick={() => updateQuestion(q.id, { retakes: !q.retakes })}
                                className="mt-4.5 flex items-center gap-2.5"
                              >
                                <Switch on={!!q.retakes} />
                                <span className="text-xs text-slate-700">Allow retakes</span>
                              </button>
                            </div>
                          )}

                          {q.type === "numeric" && (
                            <div className="flex items-center gap-3">
                              <div>
                                <label className="mb-1.5 block text-[11px] font-medium text-slate-500">
                                  Min
                                </label>
                                <input
                                  value={q.numMin ?? ""}
                                  onChange={(e) => updateQuestion(q.id, { numMin: e.target.value })}
                                  placeholder="—"
                                  className={cn(qbIn, "w-22.5")}
                                />
                              </div>
                              <div>
                                <label className="mb-1.5 block text-[11px] font-medium text-slate-500">
                                  Max
                                </label>
                                <input
                                  value={q.numMax ?? ""}
                                  onChange={(e) => updateQuestion(q.id, { numMax: e.target.value })}
                                  placeholder="—"
                                  className={cn(qbIn, "w-22.5")}
                                />
                              </div>
                            </div>
                          )}

                          {["long", "file", "date", "yesno"].includes(q.type) && (
                            <div className="text-[11px] leading-[1.5] text-slate-400">
                              {minimalNote}
                            </div>
                          )}

                          <button
                            type="button"
                            onClick={() => updateQuestion(q.id, { required: !q.required })}
                            className="flex items-center gap-2.5 border-t border-slate-100 pt-3"
                          >
                            <Switch on={q.required} />
                            <span className="text-xs text-slate-700">Required</span>
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          <div className="mt-3">
            <button
              ref={addMenuAnchorRef}
              type="button"
              onClick={() => setAddMenuOpen((v) => !v)}
              className="inline-flex h-9 items-center gap-2 rounded-lg border border-dashed border-slate-300 px-3.5 text-[13px] font-medium text-accent-11 hover:border-slate-400 hover:bg-slate-50"
            >
              <PlusIcon size={14} />
              Add question
            </button>
            <FloatingMenu
              open={addMenuOpen}
              onClose={() => setAddMenuOpen(false)}
              anchorRef={addMenuAnchorRef}
              align="start"
            >
              <div className="grid w-80 grid-cols-2 gap-0.75 rounded-[10px] border border-slate-200 bg-white p-1.5 shadow-modal">
                {TYPE_ORDER.map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => addQuestion(t)}
                    className="flex items-center gap-2.5 rounded-[7px] px-2.5 py-2 text-left hover:bg-slate-100"
                  >
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-slate-100 text-slate-600">
                      <TypeIcon type={t} />
                    </span>
                    <span className="text-xs text-slate-700">{TYPE_LABELS[t]}</span>
                  </button>
                ))}
              </div>
            </FloatingMenu>
          </div>

          <div className="mt-5.5 border-t border-slate-200 pt-4.5">
            <div className="mb-2.5 font-mono text-[11px] uppercase tracking-[0.08em] text-slate-400">
              On completion
            </div>

            <p className="mb-2 text-[11px] leading-relaxed text-slate-500">
              Applies whatever the answers are. An option&rsquo;s own routing rule beats it.
            </p>
            <div>
              <button
                ref={completionAnchorRef}
                type="button"
                onClick={() => setCompletionOpen((v) => !v)}
                className={cn(qbIn, "flex max-w-80 items-center justify-between")}
              >
                <span className="flex items-center gap-2">
                  <RouteArrow color="#64748B" />
                  Move to: {stageLabel(completionStageId) ?? "No move"}
                </span>
                <ChevronDownIcon size={13} className="text-slate-500" />
              </button>
              <FloatingMenu
                open={completionOpen}
                onClose={() => setCompletionOpen(false)}
                anchorRef={completionAnchorRef}
                align="start"
              >
                <div className="max-h-55 w-60 overflow-y-auto rounded-lg border border-slate-200 bg-white p-1 shadow-popover">
                  {completionChoices.map((r) => (
                    <button
                      key={r.value || "none"}
                      type="button"
                      onClick={() => {
                        setCompletionStageId(r.value === "" ? null : r.value);
                        setCompletionOpen(false);
                      }}
                      className="flex w-full items-center gap-2 rounded-md px-2 py-1.75 text-left text-xs text-slate-700 hover:bg-slate-100"
                    >
                      <span
                        className="h-1.5 w-1.5 rounded-full"
                        style={{ backgroundColor: r.dot }}
                      />
                      {r.label}
                    </button>
                  ))}
                </div>
              </FloatingMenu>
            </div>
          </div>

          <div className="mt-5.5 border-t border-slate-200 pt-4.5">
            <div className="mb-2.5 font-mono text-[11px] uppercase tracking-[0.08em] text-slate-400">
              Emails
            </div>
            <p className="mb-3 text-[11px] leading-relaxed text-slate-500">
              The email that sends this questionnaire, and the reminder if it is not finished.
            </p>
            <QuestionnaireEmailsPanel
              inviteEmail={inviteEmail}
              reminderEmail={reminderEmail}
              onChange={(kind, choice) =>
                kind === "invite" ? setInviteEmail(choice) : setReminderEmail(choice)
              }
            />
          </div>
        </div>

        <div className="min-w-0 flex-1 overflow-y-auto bg-slate-100">
          <div className="mx-auto max-w-115 px-5 pb-12 pt-6">
            <div className="mb-3 text-center font-mono text-[11px] uppercase tracking-[0.1em] text-slate-400">
              Live preview · candidate view
            </div>
            <div className="rounded-[14px] border border-slate-200 bg-white px-6 py-6.5 shadow-[0_4px_18px_rgba(15,23,42,0.06)]">
              <div className="mb-1 text-lg font-semibold tracking-[-0.01em] text-slate-900">
                {name}
              </div>
              <div className="mb-5.5 text-xs text-slate-400">
                Please answer the questions below.
              </div>
              <div className="flex flex-col gap-5.5">
                {questions.map((q) => (
                  <PreviewField key={q.id} q={q} />
                ))}
              </div>
              <button
                type="button"
                className="mt-6.5 h-10 w-full rounded-[9px] bg-accent-9 text-sm font-medium text-white hover:bg-accent-10"
              >
                Submit
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function PreviewField({ q }: { q: Question }) {
  const opts = q.options ?? [];
  const videoMeta = `${q.videoMax ?? "1 min"}${q.retakes ? " · retakes" : ""}`;

  return (
    <div>
      <div className="mb-0.75 text-[13px] font-medium text-slate-900">
        {q.prompt}
        {q.required && <span className="text-red-600"> *</span>}
      </div>
      <RichTextView text={q.help} className="mb-2 text-[11px] leading-relaxed text-slate-500" />
      <div className="mt-1.75">
        {q.type === "short" && (
          <div className="h-8.5 rounded-[7px] border border-slate-300 bg-slate-50" />
        )}
        {q.type === "long" && (
          <div className="h-18.5 rounded-[7px] border border-slate-300 bg-slate-50" />
        )}
        {q.type === "single" && (
          <div className="flex flex-col gap-2">
            {opts.map((o, i) => (
              <div key={i} className="flex items-center gap-2.5">
                <span className="h-3.75 w-3.75 rounded-full border-[1.5px] border-slate-300" />
                <span className="text-[13px] text-slate-700">{o.label}</span>
              </div>
            ))}
          </div>
        )}
        {q.type === "multiple" && (
          <div className="flex flex-col gap-2">
            {opts.map((o, i) => (
              <div key={i} className="flex items-center gap-2.5">
                <span className="h-3.75 w-3.75 rounded border-[1.5px] border-slate-300" />
                <span className="text-[13px] text-slate-700">{o.label}</span>
              </div>
            ))}
          </div>
        )}
        {q.type === "dropdown" && (
          <div className="flex h-8.5 items-center justify-between rounded-[7px] border border-slate-300 bg-slate-50 px-2.75">
            <span className="text-[13px] text-slate-400">Select…</span>
            <ChevronDownIcon size={13} className="text-slate-400" />
          </div>
        )}
        {q.type === "numeric" && (
          <div className="flex h-8.5 w-35 items-center rounded-[7px] border border-slate-300 bg-slate-50 px-2.75">
            <span className="text-[13px] text-slate-400">0</span>
          </div>
        )}
        {q.type === "date" && (
          <div className="flex h-8.5 w-45 items-center justify-between rounded-[7px] border border-slate-300 bg-slate-50 px-2.75">
            <span className="text-[13px] text-slate-400">DD / MM / YYYY</span>
            <Calendar size={14} color="#94A3B8" aria-hidden="true" />
          </div>
        )}
        {q.type === "yesno" && (
          <div className="flex gap-2">
            <div className="flex h-8.5 items-center rounded-[7px] border border-slate-300 bg-slate-50 px-5 text-[13px] text-slate-700">
              Yes
            </div>
            <div className="flex h-8.5 items-center rounded-[7px] border border-slate-300 bg-slate-50 px-5 text-[13px] text-slate-700">
              No
            </div>
          </div>
        )}
        {q.type === "video" && (
          <div className="overflow-hidden rounded-[9px] border border-slate-300">
            <div
              className="flex items-center justify-center bg-slate-900"
              style={{ aspectRatio: "16 / 9" }}
            >
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-white/15">
                <span className="h-3 w-3 rounded-full bg-red-500" />
              </div>
            </div>
            <div className="flex items-center justify-between px-2.75 py-2 text-[11px] text-slate-500">
              <span>Record your answer</span>
              <span className="font-mono">{videoMeta}</span>
            </div>
          </div>
        )}
        {q.type === "file" && (
          <div className="rounded-[9px] border border-dashed border-slate-300 bg-slate-50 p-4.5 text-center">
            <Upload size={18} color="#94A3B8" className="mx-auto" aria-hidden="true" />
            <div className="mt-1.5 text-xs text-slate-400">Drag a file or click to upload</div>
          </div>
        )}
      </div>
    </div>
  );
}
