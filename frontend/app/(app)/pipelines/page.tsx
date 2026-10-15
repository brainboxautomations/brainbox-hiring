"use client";

import { useMemo, useState } from "react";
import { useNavigate } from "@/hooks/use-navigate";
import {
  AlertCircle,
  BarChart3,
  ChevronDown,
  ChevronLeft,
  ChevronUp,
  Copy,
  Trash2,
  X,
  Zap,
} from "lucide-react";

import { cn } from "@/utilities/cn";
import { Button } from "@/components/atoms/button";
import { EditableTitleInput } from "@/components/atoms/editable-title-input";
import { PlusIcon, SearchIcon } from "@/components/atoms/icons";
import { Tooltip } from "@/components/atoms/tooltip";
import { ConfirmDialog } from "@/components/molecules/confirm-dialog";
import {
  usePipelines,
  useCreatePipeline,
  useUpdatePipeline,
  useDeletePipeline,
} from "@/hooks/use-pipelines";
import type { Pipeline, PipelineInput } from "@/types/api";

const ICON_TINTS = [
  "bg-accent-3 text-accent-11",
  "bg-violet-100 text-violet-700",
  "bg-green-100 text-green-700",
  "bg-amber-100 text-amber-700",
];

const STAGE_DOT_CLASS = "bg-slate-400";

type View = "list" | "editor";

type EditorStage = { id?: string; name: string };

const NEW_PIPELINE_STAGES: EditorStage[] = [
  { name: "Applied" },
  { name: "Hired" },
  { name: "Rejected" },
];

function BarsIcon({ size = 17 }: { size?: number }) {
  return <BarChart3 size={size} aria-hidden="true" />;
}

function DuplicateIcon() {
  return <Copy size={14} aria-hidden="true" />;
}

function ChevronUpMini() {
  return <ChevronUp size={11} aria-hidden="true" />;
}

function ChevronDownMini() {
  return <ChevronDown size={11} aria-hidden="true" />;
}

function XMini() {
  return <X size={13} aria-hidden="true" />;
}

function BackChevron() {
  return <ChevronLeft size={13} aria-hidden="true" />;
}

function BoltIcon() {
  return <Zap size={13} aria-hidden="true" />;
}

type EditorTarget = { id: string | null; name: string; usage: number; stages: EditorStage[] };

type DeleteTarget = { id: string; name: string; usage: number };

export default function PipelinesPage() {
  const navigate = useNavigate();
  const [view, setView] = useState<View>("list");
  const [search, setSearch] = useState("");
  const [editor, setEditor] = useState<EditorTarget | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null);

  const { data: pipelines, isLoading, isError, error, refetch, isFetching } = usePipelines();
  const deletePipeline = useDeletePipeline();

  function confirmDelete() {
    if (!deleteTarget) return;
    deletePipeline.mutate(deleteTarget.id, {
      onSuccess: () => {
        setDeleteTarget(null);
        setView("list");
      },
    });
  }

  const deleteDialog = (
    <ConfirmDialog
      open={deleteTarget != null}
      title={`Delete "${deleteTarget?.name}"?`}
      description={
        deleteTarget && deleteTarget.usage > 0
          ? `Used by ${deleteTarget.usage} ${deleteTarget.usage === 1 ? "position" : "positions"}. Those positions keep their existing stages — deleting only removes the reusable template.`
          : "This cannot be undone."
      }
      confirmLabel="Delete"
      danger
      loading={deletePipeline.isPending}
      onCancel={() => setDeleteTarget(null)}
      onConfirm={confirmDelete}
    />
  );

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return (pipelines ?? []).filter((t) => !q || t.name.toLowerCase().includes(q));
  }, [pipelines, search]);

  function openEditor(p: Pipeline) {
    setEditor({
      id: p.id,
      name: p.name,
      usage: p.usageCount,
      stages: p.stages.map((s) => ({ id: s.id, name: s.name })),
    });
    setView("editor");
  }

  function openNew() {
    setEditor({ id: null, name: "Untitled pipeline", usage: 0, stages: [...NEW_PIPELINE_STAGES] });
    setView("editor");
  }

  if (view === "editor" && editor) {
    return (
      <>
        <PipelineEditor
          target={editor}
          onChange={setEditor}
          onBack={() => setView("list")}
          onEditActions={() => navigate.push("/pipelines/stage-actions")}
          onDelete={(target) =>
            target.id && setDeleteTarget({ id: target.id, name: target.name, usage: target.usage })
          }
        />
        {deleteDialog}
      </>
    );
  }

  const noResults = filtered.length === 0 && !isLoading && !isError && (pipelines?.length ?? 0) > 0;
  const isEmpty = !isLoading && !isError && (pipelines?.length ?? 0) === 0;

  return (
    <div className="mx-auto max-w-235 px-8 pb-16 pt-7">
      <div className="mb-1.5 flex items-end justify-between gap-5">
        <div>
          <h1 className="mb-1 text-2xl font-semibold tracking-[-0.02em]">Pipeline templates</h1>
          <p className="text-[13px] text-slate-500">
            Company-level pipelines reused across positions.
          </p>
        </div>
        <Button
          variant="primary"
          leadingIcon={<PlusIcon size={14} />}
          className="h-8.5 rounded-lg"
          onClick={openNew}
        >
          Create pipeline
        </Button>
      </div>

      <div className="my-4.5 mb-3.5 flex items-center gap-2.5">
        <div className="flex h-8.5 w-65 items-center gap-2 rounded-lg border border-slate-300 bg-white px-2.75">
          <SearchIcon size={14} className="shrink-0 text-slate-400" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search templates…"
            className="min-w-0 flex-1 bg-transparent text-[13px] text-slate-900 outline-none placeholder:text-slate-400"
          />
        </div>
      </div>

      {isLoading && (
        <div className="flex flex-col gap-2.5">
          {[1, 2, 3, 4].map((r) => (
            <div
              key={r}
              className="flex h-17 items-center gap-3.5 rounded-xl border border-slate-200 bg-white px-4.5"
            >
              <div className="h-8.5 w-8.5 animate-[ds-shimmer_1.4s_infinite] rounded-[9px] bg-[linear-gradient(90deg,#F1F5F9_25%,#E2E8F0_37%,#F1F5F9_63%)] bg-[length:400px_100%]" />
              <div className="flex flex-1 flex-col gap-1.75">
                <div className="h-2.5 w-45 animate-[ds-shimmer_1.4s_infinite] rounded bg-[linear-gradient(90deg,#F1F5F9_25%,#E2E8F0_37%,#F1F5F9_63%)] bg-[length:400px_100%]" />
                <div className="h-2 w-30 animate-[ds-shimmer_1.4s_infinite] rounded bg-[linear-gradient(90deg,#F1F5F9_25%,#E2E8F0_37%,#F1F5F9_63%)] bg-[length:400px_100%]" />
              </div>
            </div>
          ))}
        </div>
      )}

      {isError && (
        <div className="flex flex-col items-center rounded-xl border border-red-200 bg-red-50 px-5 py-16 text-center">
          <div className="mb-1.5 text-[15px] font-semibold text-red-800">
            Couldn’t load pipelines
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
            <BarsIcon size={22} />
          </div>
          <div className="mb-1.5 text-[15px] font-semibold">No pipelines yet</div>
          <div className="mb-4.5 max-w-85 text-[13px] leading-[1.55] text-slate-500">
            Create a reusable pipeline template that positions can share.
          </div>
          <Button
            variant="primary"
            leadingIcon={<PlusIcon size={14} />}
            className="h-8.5 rounded-lg"
            onClick={openNew}
          >
            Create pipeline
          </Button>
        </div>
      )}

      {!isLoading && !isError && !isEmpty && (
        <div className="flex flex-col gap-2.5">
          {filtered.map((t, i) => (
            <TemplateRow
              key={t.id}
              template={t}
              tint={ICON_TINTS[i % ICON_TINTS.length]!}
              onEdit={() => openEditor(t)}
              onDelete={() => setDeleteTarget({ id: t.id, name: t.name, usage: t.usageCount })}
            />
          ))}
          {noResults && (
            <div className="p-10 text-center text-[13px] text-slate-400">
              No templates match your search.
            </div>
          )}
        </div>
      )}
      {deleteDialog}
    </div>
  );
}

function TemplateRow({
  template,
  tint,
  onEdit,
  onDelete,
}: {
  template: Pipeline;
  tint: string;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const createPipeline = useCreatePipeline();
  const usageText = template.usageCount === 1 ? "1 position" : `${template.usageCount} positions`;

  function duplicate() {
    createPipeline.mutate({
      name: `${template.name} (copy)`,
      stages: template.stages.map((s) => ({ name: s.name })),
    });
  }

  return (
    <div
      onClick={onEdit}
      className="flex cursor-pointer items-center gap-3.5 rounded-xl border border-slate-200 bg-white px-4.5 py-3.75 shadow-card transition-colors hover:border-slate-300 hover:bg-slate-50/40"
    >
      <div className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-[9px]", tint)}>
        <BarsIcon size={17} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-sm font-semibold text-slate-900">{template.name}</div>
        <div className="mt-0.5 flex items-center gap-2 text-xs text-slate-500">
          <span>{template.stages.length} stages</span>
          <span className="text-slate-300">·</span>
          <span>{usageText}</span>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onEdit();
          }}
          className="inline-flex h-7.5 items-center gap-1.5 rounded-[7px] border border-slate-300 bg-white px-2.75 text-xs font-medium text-slate-700 hover:bg-slate-50"
        >
          Edit
        </button>
        <Tooltip label="Duplicate">
          <button
            type="button"
            aria-label="Duplicate"
            disabled={createPipeline.isPending}
            onClick={(e) => {
              e.stopPropagation();
              duplicate();
            }}
            className="flex h-7.5 w-7.5 items-center justify-center rounded-[7px] border border-slate-300 bg-white text-slate-600 hover:bg-slate-50 disabled:opacity-50"
          >
            <DuplicateIcon />
          </button>
        </Tooltip>
        <Tooltip label="Delete">
          <button
            type="button"
            aria-label="Delete"
            onClick={(e) => {
              e.stopPropagation();
              onDelete();
            }}
            className="flex h-7.5 w-7.5 items-center justify-center rounded-[7px] border border-slate-300 bg-white text-slate-500 hover:border-red-200 hover:bg-red-50 hover:text-red-600"
          >
            <TrashIcon />
          </button>
        </Tooltip>
      </div>
    </div>
  );
}

function TrashIcon() {
  return <Trash2 size={14} aria-hidden="true" />;
}

function PipelineEditor({
  target,
  onChange,
  onBack,
  onEditActions,
  onDelete,
}: {
  target: EditorTarget;
  onChange: (t: EditorTarget) => void;
  onBack: () => void;
  onEditActions: () => void;
  onDelete: (target: EditorTarget) => void;
}) {
  const createPipeline = useCreatePipeline();
  const updatePipeline = useUpdatePipeline();
  const [saveError, setSaveError] = useState<string | null>(null);
  const saving = createPipeline.isPending || updatePipeline.isPending;

  const { name, usage, stages } = target;
  const usageText = usage === 1 ? "1 position" : `${usage} positions`;

  const setStages = (next: EditorStage[]) => onChange({ ...target, stages: next });
  const setName = (v: string) => onChange({ ...target, name: v });

  function rename(i: number, v: string) {
    setStages(stages.map((st, j) => (j === i ? { ...st, name: v } : st)));
  }

  function remove(i: number) {
    setStages(stages.filter((_, j) => j !== i));
  }
  function move(i: number, dir: -1 | 1) {
    const j = i + dir;
    if (j < 0 || j >= stages.length) return;
    const next = [...stages];
    const a = next[i]!;
    const b = next[j]!;
    next[i] = b;
    next[j] = a;
    setStages(next);
  }
  function addStage() {
    setStages([...stages, { name: "New stage" }]);
  }

  function save() {
    setSaveError(null);
    const input: PipelineInput = {
      name: name.trim(),
      // Send the id back for stages that already exist — the handler uses it to
      // update them in place instead of recreating them, which is what keeps
      // live positions linked to their stages.
      stages: stages.map((s) => ({ ...(s.id ? { id: s.id } : {}), name: s.name.trim() })),
    };
    const onError = (e: unknown) =>
      setSaveError(e instanceof Error ? e.message : "Could not save pipeline");

    if (target.id) {
      updatePipeline.mutate({ id: target.id, input }, { onSuccess: onBack, onError });
    } else {
      createPipeline.mutate(input, { onSuccess: onBack, onError });
    }
  }

  return (
    <div className="mx-auto max-w-180 px-8 pb-16 pt-6">
      <button
        type="button"
        onClick={onBack}
        className="mb-4 inline-flex items-center gap-1.5 text-xs text-slate-500 hover:text-accent-11"
      >
        <BackChevron />
        All templates
      </button>

      <div className="mb-1.5">
        <EditableTitleInput
          value={name}
          onChange={setName}
          ariaLabel="Pipeline name"
          wrapperClassName="w-full"
          inputClassName="w-full text-[22px]"
        />
        <p className="mt-1 text-[13px] text-slate-500">
          {stages.length} stages · used by {usageText}
        </p>
      </div>

      <div className="my-4.5 flex items-start gap-2.5 rounded-[9px] border border-amber-200 bg-amber-50 px-3.5 py-2.75">
        <AlertCircle size={15} className="mt-px shrink-0 text-amber-700" aria-hidden="true" />
        <span className="text-xs leading-[1.5] text-amber-800">
          Reordering affects only <strong>new</strong> positions — stage order is frozen once a
          position goes live.
        </span>
      </div>

      <div className="mb-2.5 font-mono text-[11px] uppercase tracking-[0.1em] text-slate-400">
        Stages
      </div>
      <div className="flex flex-col gap-2">
        {stages.map((st, i) => {
          const first = i === 0;
          const last = i === stages.length - 1;
          return (
            <div
              key={st.id ?? i}
              className="flex items-center gap-2.5 rounded-[10px] border border-slate-200 bg-white px-3 py-2.5"
            >
              <div className="flex shrink-0 flex-col gap-px">
                <button
                  type="button"
                  onClick={() => move(i, -1)}
                  disabled={first}
                  className={cn(
                    "flex h-3.75 w-5 items-center justify-center rounded",
                    first ? "cursor-default text-slate-200" : "text-slate-400 hover:bg-slate-100",
                  )}
                >
                  <ChevronUpMini />
                </button>
                <button
                  type="button"
                  onClick={() => move(i, 1)}
                  disabled={last}
                  className={cn(
                    "flex h-3.75 w-5 items-center justify-center rounded",
                    last ? "cursor-default text-slate-200" : "text-slate-400 hover:bg-slate-100",
                  )}
                >
                  <ChevronDownMini />
                </button>
              </div>

              <span className={cn("h-2 w-2 shrink-0 rounded-full", STAGE_DOT_CLASS)} />

              <input
                value={st.name}
                onChange={(e) => rename(i, e.target.value)}
                className="min-w-0 flex-1 bg-transparent text-[13px] font-medium text-slate-900 outline-none"
              />

              <Tooltip label="Edit stage actions">
                <button
                  type="button"
                  aria-label="Edit stage actions"
                  onClick={onEditActions}
                  className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-slate-400 hover:bg-accent-3 hover:text-accent-11"
                >
                  <BoltIcon />
                </button>
              </Tooltip>

              <Tooltip label="Remove stage">
                <button
                  type="button"
                  aria-label="Remove stage"
                  onClick={() => remove(i)}
                  className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-slate-400 hover:bg-red-50 hover:text-red-600"
                >
                  <XMini />
                </button>
              </Tooltip>
            </div>
          );
        })}
      </div>

      <button
        type="button"
        onClick={addStage}
        className="mt-3 inline-flex items-center gap-1.5 px-0.5 py-1.5 text-[13px] text-accent-11 hover:underline"
      >
        <PlusIcon size={13} />
        Add stage
      </button>

      {saveError && (
        <div
          role="alert"
          className="mt-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-[12px] text-red-700"
        >
          {saveError}
        </div>
      )}

      <div className="mt-7 flex items-center gap-2.5 border-t border-slate-200 pt-5">
        <Button variant="primary" className="h-9 rounded-lg px-4.5" loading={saving} onClick={save}>
          Save changes
        </Button>
        <Button variant="secondary" className="h-9 rounded-lg" onClick={onBack}>
          Cancel
        </Button>
        {target.id && (
          <Button variant="reject" className="h-9 rounded-lg" onClick={() => onDelete(target)}>
            Delete
          </Button>
        )}
      </div>
    </div>
  );
}
