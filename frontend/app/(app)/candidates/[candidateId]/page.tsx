"use client";

import { useMemo, useRef, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { useNavigate } from "@/hooks/use-navigate";
import Link from "next/link";

import { cn } from "@/utilities/cn";
import { apiErrorMessage } from "@/utilities/api-error";
import { APPLY_FIELD_DEFS, type ApplyFieldKey } from "@/utilities/application-form-fields";
import {
  useCandidateProfile,
  useCandidates,
  useNotes,
  useAddNote,
  useUpdateCandidate,
} from "@/hooks/use-candidates";
import { useUpdatePerson } from "@/hooks/use-people";
import { useResendQuestionnaire, useSetQuestionnaireReminders } from "@/hooks/use-questionnaires";
import { questionnaireResendAction } from "@/utilities/questionnaire-resend";
import { SendQuestionnaireMenu } from "@/components/organisms/send-questionnaire-menu";
import { questionnaireCompletionState } from "@/utilities/questionnaire-status";
import {
  boardStageOrder,
  neighbouringCandidates,
  orderedBoardCandidates,
  parseCandidateNavigationContext,
  NO_NEIGHBOURS,
} from "@/utilities/candidate-navigation";
import { CandidateNavigator } from "@/components/organisms/candidate-navigator";
import { FloatingMenu } from "@/components/molecules/floating-menu";
import { DocxPreview } from "@/components/molecules/docx-preview";
import { UpcomingAutomations } from "@/components/organisms/upcoming-automations";
import { resumePreviewKind } from "@/utilities/resume-preview";
import type {
  AnswerMedia,
  CandidateProfile,
  ProfileDocument,
  QuestionnaireResponseDetail,
} from "@/types/api";
import { Avatar } from "@/components/atoms/avatar";
import { ProfileEmailThread } from "@/components/organisms/inbox/profile-email-thread";
import { Badge } from "@/components/atoms/badge";
import { Tooltip } from "@/components/atoms/tooltip";
import { Button } from "@/components/atoms/button";
import { Input } from "@/components/atoms/input";
import { SectionLabel } from "@/components/atoms/card";
import { ErrorAlert } from "@/components/molecules/error-alert";
import {
  ArrowLeftIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  MailIcon,
  StarIcon,
  DotsIcon,
  PlusIcon,
  CloseIcon,
  CheckIcon,
  DocumentIcon,
  ExternalLinkIcon,
  AlertCircleIcon,
  HelpIcon,
} from "@/components/atoms/icons";

type ContentTab = "experience" | "resume" | "documents" | "questionnaires";
type CommTab = "email" | "notes";
type ActionFailure = { title: string; message: string };

const STAGE_DOT_CLASS = "bg-slate-400";

const FIELD_LABEL = Object.fromEntries(APPLY_FIELD_DEFS.map((f) => [f.key, f.label])) as Record<
  ApplyFieldKey,
  string
>;

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function questionnaireTimeline(response: QuestionnaireResponseDetail): string {
  if (response.context === "application_embedded") {
    return `From application ${formatDate(response.completedAt)}`;
  }
  if (response.status === "completed") {
    return `Sent ${formatDate(response.sentAt)} · completed ${formatDate(response.completedAt)}`;
  }
  return `Sent ${formatDate(response.sentAt)} · not completed yet`;
}

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function answerText(value: string | number | string[] | null): string {
  if (value === null || value === undefined) return "—";
  if (Array.isArray(value)) return value.length ? value.join(", ") : "—";
  const s = String(value).trim();
  return s.length ? s : "—";
}

export default function CandidateProfilePage() {
  const params = useParams<{ candidateId: string }>();
  const applicationId = params.candidateId;
  const profileQuery = useCandidateProfile(applicationId);

  if (profileQuery.isLoading) {
    return (
      <div className="flex h-full items-center justify-center text-[13px] text-slate-400">
        Loading candidate…
      </div>
    );
  }

  if (profileQuery.isError || !profileQuery.data) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
        <div className="text-[15px] font-semibold text-red-800">Couldn’t load this candidate</div>
        <div className="max-w-85 text-[13px] leading-relaxed text-red-700">
          {profileQuery.error instanceof Error
            ? profileQuery.error.message
            : "The application may have been removed."}
        </div>
        <Button
          variant="secondary"
          size="sm"
          loading={profileQuery.isFetching}
          onClick={() => profileQuery.refetch()}
        >
          Try again
        </Button>
      </div>
    );
  }

  return (
    <ProfileView key={applicationId} applicationId={applicationId} profile={profileQuery.data} />
  );
}

function ProfileView({
  applicationId,
  profile,
}: {
  applicationId: string;
  profile: CandidateProfile;
}) {
  const navigate = useNavigate();
  // Separate from `navigate`, so Email and Board each spin only when pressed.
  const composeNavigate = useNavigate();
  const searchParams = useSearchParams();

  const { application, person, stages, applications, documents, questionnaires } = profile;
  const boardPositionId = searchParams.get("position") ?? application.positionId;

  const updateCandidate = useUpdateCandidate(boardPositionId);
  const updatePerson = useUpdatePerson(applicationId);
  const setQuestionnaireReminders = useSetQuestionnaireReminders(applicationId);
  const notesQuery = useNotes(applicationId);
  const addNote = useAddNote(applicationId);

  const [tab, setTab] = useState<ContentTab>("experience");
  const [commTab, setCommTab] = useState<CommTab>("notes");
  const [stageMenuOpen, setStageMenuOpen] = useState(false);
  const stageMenuAnchorRef = useRef<HTMLButtonElement>(null);
  const [positionMenuOpen, setPositionMenuOpen] = useState(false);
  const positionMenuAnchorRef = useRef<HTMLButtonElement>(null);
  const [expandedQ, setExpandedQ] = useState<string | null>(questionnaires[0]?.id ?? null);

  const [failure, setFailure] = useState<ActionFailure | null>(null);

  const [attrs, setAttrs] = useState<{ key: string; value: string }[]>(() =>
    Object.entries(person.customAttributes).map(([key, value]) => ({ key, value })),
  );

  const [noteDraft, setNoteDraft] = useState("");

  const starred = application.starred;
  const stageId = application.stageId;

  const name = `${person.firstName} ${person.lastName ?? ""}`.trim();
  const stage = stages.find((s) => s.id === stageId) ?? null;
  const notes = notesQuery.data ?? [];

  const navigationContext = useMemo(() => {
    const parsed = parseCandidateNavigationContext(new URLSearchParams(searchParams.toString()));
    if (!parsed || parsed.positionId !== application.positionId) return null;
    return parsed;
  }, [searchParams, application.positionId]);

  const boardCandidates = useCandidates(navigationContext?.positionId ?? null);

  const neighbours = useMemo(() => {
    if (!navigationContext) return NO_NEIGHBOURS;

    const ordered = orderedBoardCandidates(
      boardCandidates.data ?? [],
      boardStageOrder(stages),
      navigationContext.filters,
      new Date(),
    );

    return neighbouringCandidates(
      ordered.map((candidate) => candidate.id),
      applicationId,
    );
  }, [navigationContext, boardCandidates.data, stages, applicationId]);

  const onFailure = (title: string, fallback: string) => (error: unknown) =>
    setFailure({ title, message: apiErrorMessage(error, fallback) });

  const toggleStar = () => {
    setFailure(null);
    updateCandidate.mutate(
      { id: applicationId, patch: { starred: !starred } },
      {
        onError: onFailure(
          starred ? "Couldn’t unstar this candidate" : "Couldn’t star this candidate",
          "The server refused the change, so the star is unchanged.",
        ),
      },
    );
  };

  const changeStage = (id: string) => {
    setStageMenuOpen(false);
    setFailure(null);
    updateCandidate.mutate(
      { id: applicationId, patch: { stageId: id } },
      {
        onError: onFailure(
          "Couldn’t move this candidate",
          "The server refused the change, so they are still in their previous stage.",
        ),
      },
    );
  };

  const persistAttrs = () => {
    const customAttributes: Record<string, string> = {};
    for (const { key, value } of attrs) {
      const k = key.trim();
      if (k) customAttributes[k] = value;
    }
    setFailure(null);
    updatePerson.mutate(
      { id: person.id, patch: { customAttributes } },
      {
        onError: onFailure(
          "Couldn’t save the custom attributes",
          "The server refused the change. What you typed is still here — leave the field again to retry.",
        ),
      },
    );
  };

  const submitNote = (body: string, clear: () => void) => {
    const trimmed = body.trim();
    if (!trimmed) return;
    setFailure(null);
    addNote.mutate(trimmed, {
      onSuccess: clear,
      onError: onFailure(
        "Couldn’t save this note",
        "The server refused it, so nothing was posted. Your text is still in the box.",
      ),
    });
  };

  const setReminders = (responseId: string, stopped: boolean) => {
    setFailure(null);
    setQuestionnaireReminders.mutate(
      { responseId, stopped },
      {
        onError: onFailure(
          "Couldn’t change the reminders",
          "The server refused the change, so the reminder schedule is unchanged.",
        ),
      },
    );
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-white">
      <div className="shrink-0 border-b border-slate-200">
        <div className="flex items-center gap-2 px-3.5 py-2.5">
          <Button
            variant="secondary"
            size="sm"
            leadingIcon={<ArrowLeftIcon size={14} />}
            loading={navigate.isNavigating}
            onClick={() => navigate.push(`/positions/${boardPositionId}/board`)}
          >
            Board
          </Button>
          <CandidateNavigator context={navigationContext} neighbours={neighbours} />

          <div className="relative">
            <button
              ref={positionMenuAnchorRef}
              type="button"
              onClick={() => setPositionMenuOpen((v) => !v)}
              className="flex items-center gap-1.5 rounded-md px-1.5 py-1 font-mono text-[11px] text-slate-500 hover:bg-slate-100"
            >
              {application.positionTitle}
              {applications.length > 1 && <ChevronDownIcon size={12} className="text-slate-400" />}
            </button>
            <FloatingMenu
              open={positionMenuOpen && applications.length > 1}
              onClose={() => setPositionMenuOpen(false)}
              anchorRef={positionMenuAnchorRef}
              align="start"
            >
              <div className="w-70 rounded-xl border border-slate-200 bg-white p-1.5 shadow-modal">
                <div className="px-2 py-1 font-mono text-[10px] uppercase tracking-[0.08em] text-slate-400">
                  {person.firstName}’s applications
                </div>
                {applications.map((a) => (
                  <Link
                    key={a.applicationId}
                    href={`/candidates/${a.applicationId}?position=${a.positionId}`}
                    onClick={() => setPositionMenuOpen(false)}
                    className={cn(
                      "flex items-center gap-2.5 rounded-md px-2.5 py-2 hover:bg-slate-100",
                      a.applicationId === applicationId && "bg-slate-50",
                    )}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[13px] font-medium text-slate-900">
                        {a.positionTitle}
                      </div>
                      <div className="text-[11px] text-slate-400">{a.stageName ?? "No stage"}</div>
                    </div>
                    {a.applicationId === applicationId && (
                      <CheckIcon size={13} className="text-accent-9" />
                    )}
                  </Link>
                ))}
              </div>
            </FloatingMenu>
          </div>

          <div className="flex-1" />
          <button
            type="button"
            onClick={toggleStar}
            className="flex h-7.5 w-7.5 items-center justify-center rounded-md hover:bg-slate-100"
            aria-label={starred ? "Unstar" : "Star"}
          >
            <StarIcon
              size={16}
              filled={starred}
              className={starred ? "text-amber-600" : "text-slate-300"}
            />
          </button>
          <button
            type="button"
            className="flex h-7.5 w-7.5 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100"
            aria-label="More"
          >
            <DotsIcon size={16} />
          </button>
        </div>

        <div className="flex items-center gap-3.5 px-5 pb-4.5 pt-1">
          <Avatar name={name} size={52} />
          <div className="min-w-0 flex-1">
            <div className="text-xl font-semibold leading-tight tracking-[-0.015em]">{name}</div>
            <div className="mt-0.5 text-[13px] text-slate-500">
              {person.headline || person.email}
            </div>
          </div>
          <div className="relative">
            <button
              ref={stageMenuAnchorRef}
              type="button"
              onClick={() => setStageMenuOpen((v) => !v)}
              disabled={stages.length === 0}
              className="flex h-8.5 items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 hover:bg-slate-50 disabled:opacity-50"
            >
              <span
                className={cn(
                  "h-1.75 w-1.75 rounded-full",
                  stage ? STAGE_DOT_CLASS : "bg-slate-300",
                )}
              />
              <span className="text-[13px] font-medium text-slate-700">
                {stage?.name ?? "No stage"}
              </span>
              <ChevronDownIcon size={13} className="text-slate-500" />
            </button>
            <FloatingMenu
              open={stageMenuOpen}
              onClose={() => setStageMenuOpen(false)}
              anchorRef={stageMenuAnchorRef}
              align="end"
            >
              <div className="max-h-75 w-60 overflow-y-auto rounded-xl border border-slate-200 bg-white p-1.5 shadow-modal">
                {stages.map((o) => (
                  <button
                    key={o.id}
                    type="button"
                    onClick={() => changeStage(o.id)}
                    className={cn(
                      "flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 hover:bg-slate-100",
                      o.id === stageId && "bg-slate-50",
                    )}
                  >
                    <span className={cn("h-1.75 w-1.75 shrink-0 rounded-full", STAGE_DOT_CLASS)} />
                    <span className="flex-1 truncate text-left text-[13px] text-slate-700">
                      {o.name}
                    </span>
                    {o.id === stageId && <CheckIcon size={13} className="text-accent-9" />}
                  </button>
                ))}
              </div>
            </FloatingMenu>
          </div>
          {/* Was a permanently disabled placeholder; opens the composer for this
              candidate, as the Email thread tab's Compose does. */}
          <Button
            variant="primary"
            leadingIcon={<MailIcon size={14} />}
            className="h-8.5 rounded-lg"
            loading={composeNavigate.isNavigating}
            onClick={() => composeNavigate.push(`/compose?applicationId=${applicationId}`)}
          >
            Email
          </Button>
        </div>

        {application.resubmissionAttempts.count > 0 && (
          <div className="px-5 pb-4">
            <ResubmissionAttemptsNotice resubmissionAttempts={application.resubmissionAttempts} />
          </div>
        )}

        {profile.upcomingAutomations.length > 0 && (
          <div className="px-5 pb-4">
            <UpcomingAutomations items={profile.upcomingAutomations} />
          </div>
        )}

        {failure && (
          <div className="px-5 pb-4">
            <ErrorAlert title={failure.title} message={failure.message} />
          </div>
        )}
      </div>

      <div className="flex min-h-0 flex-1">
        <div className="flex min-w-0 flex-1 flex-col border-r border-slate-200">
          <div className="flex shrink-0 items-center gap-6 border-b border-slate-200 px-5">
            {(
              [
                ["experience", "Experience"],
                ["resume", "Resume / CV"],
                ["documents", "Documents"],
                ["questionnaires", "Questionnaires"],
              ] as [ContentTab, string][]
            ).map(([id, label]) => {
              const on = tab === id;
              const count =
                id === "questionnaires"
                  ? questionnaires.length
                  : id === "documents"
                    ? documents.length
                    : null;
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => setTab(id)}
                  className={cn(
                    "flex items-center gap-1.5 py-3.5 text-[13px] transition-colors",
                    on
                      ? "font-medium text-accent-11 shadow-[inset_0_-2px_0_var(--color-accent-9)]"
                      : "font-normal text-slate-500 hover:text-slate-800",
                  )}
                >
                  {label}
                  {count !== null && count > 0 && (
                    <span
                      className={cn(
                        "inline-flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-semibold",
                        on ? "bg-accent-3 text-accent-10" : "bg-slate-100 text-slate-600",
                      )}
                    >
                      {count}
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          <div className="flex-1 overflow-y-auto px-6 pb-8 pt-5">
            {tab === "experience" && (
              <ExperienceTab
                formAnswers={application.formAnswers}
                questionnaires={questionnaires}
              />
            )}
            {tab === "resume" && <ResumeTab documents={documents} />}
            {tab === "documents" && <DocumentsTab documents={documents} />}
            {tab === "questionnaires" && (
              <QuestionnairesTab
                applicationId={applicationId}
                positionId={application.positionId}
                questionnaires={questionnaires}
                expandedQ={expandedQ}
                onToggle={(qid) => setExpandedQ((cur) => (cur === qid ? null : qid))}
                onSetReminders={setReminders}
                // Only the row being changed is busy; one shared flag used to
                // lock every questionnaire's button at once.
                remindersBusyId={
                  setQuestionnaireReminders.isPending
                    ? (setQuestionnaireReminders.variables?.responseId ?? null)
                    : null
                }
              />
            )}
          </div>
        </div>

        <div className="flex w-87 shrink-0 flex-col overflow-y-auto">
          <div className="border-b border-slate-200 px-4.5 pb-4.5 pt-4">
            <SectionLabel className="mb-3 tracking-[0.1em]">DETAILS</SectionLabel>
            <div className="flex flex-col gap-2.75">
              <DetailRow label="Name" value={name} />
              {person.headline && <DetailRow label="Headline" value={person.headline} />}
              <DetailRow label="Position" value={application.positionTitle} />
              <div className="flex items-center gap-2.5">
                <span className="w-18.5 shrink-0 text-[11px] text-slate-400">Stage</span>
                {stage ? (
                  <Badge tone="neutral" dot>
                    {stage.name}
                  </Badge>
                ) : (
                  <span className="text-[13px] text-slate-400">—</span>
                )}
              </div>
              <div className="my-0.5 h-px bg-slate-100" />
              <DetailRow label="Phone" value={person.phone ?? "—"} />
              <div className="flex items-baseline gap-2.5">
                <span className="w-18.5 shrink-0 text-[11px] text-slate-400">Email</span>
                <a
                  href={`mailto:${person.email}`}
                  className="min-w-0 truncate text-[13px] text-accent-11 hover:underline"
                >
                  {person.email}
                </a>
              </div>
              {person.links.map((link, i) => (
                <div key={i} className="flex items-baseline gap-2.5">
                  <span className="w-18.5 shrink-0 truncate text-[11px] text-slate-400">
                    {link.label}
                  </span>
                  <a
                    href={link.url}
                    target="_blank"
                    rel="noreferrer"
                    className="min-w-0 truncate text-[13px] text-accent-11 hover:underline"
                  >
                    {link.url}
                  </a>
                </div>
              ))}
            </div>

            <div className="mt-4">
              <div className="mb-2.5 flex items-center justify-between">
                <span className="flex items-center gap-1.5">
                  <SectionLabel className="tracking-[0.1em]">CUSTOM ATTRIBUTES</SectionLabel>
                  <Tooltip
                    side="bottom"
                    multiline
                    label="Anything about this person the standard fields don’t cover — notice period, referral source. Each key becomes an email variable such as {{custom.notice_period}}. Saved when you click out of the field."
                  >
                    <button
                      type="button"
                      aria-label="What are custom attributes?"
                      className="flex h-4 w-4 items-center justify-center rounded-full text-slate-400 hover:text-slate-600"
                    >
                      <HelpIcon size={13} />
                    </button>
                  </Tooltip>
                </span>
                <button
                  type="button"
                  onClick={() => setAttrs((a) => [...a, { key: "", value: "" }])}
                  className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] text-accent-11 hover:bg-accent-3"
                >
                  <PlusIcon size={11} />
                  Add
                </button>
              </div>
              <div className="flex flex-col gap-2">
                {attrs.length === 0 && (
                  <div className="text-[11px] text-slate-400">No custom attributes yet.</div>
                )}
                {attrs.map((a, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <Input
                      value={a.key}
                      onChange={(e) =>
                        setAttrs((arr) =>
                          arr.map((x, j) => (j === i ? { ...x, key: e.target.value } : x)),
                        )
                      }
                      onBlur={persistAttrs}
                      placeholder="Key"
                      className="h-7 min-w-0 shrink-0 basis-2/5 bg-slate-50 text-xs"
                    />
                    <Input
                      value={a.value}
                      onChange={(e) =>
                        setAttrs((arr) =>
                          arr.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)),
                        )
                      }
                      onBlur={persistAttrs}
                      placeholder="Value"
                      className="h-7 min-w-0 flex-1 text-xs"
                    />
                    <button
                      type="button"
                      onClick={() => {
                        setAttrs((arr) => arr.filter((_, j) => j !== i));

                        setTimeout(persistAttrs, 0);
                      }}
                      className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-slate-400 hover:bg-red-50 hover:text-red-600"
                      aria-label="Remove attribute"
                    >
                      <CloseIcon size={12} />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="flex min-h-75 flex-1 flex-col">
            <div className="flex items-center gap-1 px-4 pt-3">
              {(
                [
                  ["notes", "Internal notes"],
                  ["email", "Email thread"],
                ] as [CommTab, string][]
              ).map(([id, label]) => {
                const on = commTab === id;
                return (
                  <button
                    key={id}
                    type="button"
                    onClick={() => setCommTab(id)}
                    className={cn(
                      "inline-flex items-center gap-1.5 rounded-md px-2.75 py-1.5 text-xs font-medium",
                      on ? "bg-slate-900 text-white" : "text-slate-500 hover:bg-slate-100",
                    )}
                  >
                    {label}
                    {id === "notes" && notes.length > 0 && (
                      <span
                        className={cn(
                          "inline-flex h-3.75 min-w-3.75 items-center justify-center rounded-full px-1 text-[10px] font-semibold",
                          on ? "bg-slate-700 text-slate-200" : "bg-slate-100 text-slate-600",
                        )}
                      >
                        {notes.length}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>

            {commTab === "notes" ? (
              <>
                <div className="mx-4 mt-3 flex items-center gap-2 rounded-md border border-amber-200 bg-amber-50 px-2.5 py-2">
                  <span className="text-[11px] leading-snug text-amber-800">
                    Internal only — never visible to the candidate.
                  </span>
                </div>
                <div className="flex flex-1 flex-col gap-3 overflow-y-auto p-4">
                  {notes.length === 0 && (
                    <div className="mt-4 text-center text-xs text-slate-400">
                      No notes yet. Add the first one below.
                    </div>
                  )}
                  {notes.map((n) => (
                    <div key={n.id} className="flex gap-2.5">
                      <Avatar name={n.authorName ?? "Team"} size={24} />
                      <div className="min-w-0 flex-1">
                        <div className="mb-1 flex items-center gap-1.5">
                          <span className="text-xs font-semibold text-slate-700">
                            {n.authorName ?? "Team member"}
                          </span>
                          <span className="font-mono text-[10px] text-slate-400">
                            {formatDateTime(n.createdAt)}
                          </span>
                        </div>
                        <div className="rounded-lg border border-amber-200 bg-amber-50/60 px-2.5 py-1.5 text-xs leading-relaxed text-stone-700">
                          {n.body}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
                <div className="flex shrink-0 gap-2 border-t border-slate-100 px-4 pb-3.5 pt-2.5">
                  <Input
                    value={noteDraft}
                    onChange={(e) => setNoteDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") submitNote(noteDraft, () => setNoteDraft(""));
                    }}
                    placeholder="Write a note for the team…"
                    className="h-8.5 flex-1"
                  />
                  <Button
                    variant="primary"
                    className="h-8.5 shrink-0 rounded-lg bg-slate-900 hover:bg-slate-800"
                    loading={addNote.isPending}
                    onClick={() => submitNote(noteDraft, () => setNoteDraft(""))}
                  >
                    Post
                  </Button>
                </div>
              </>
            ) : (
              <ProfileEmailThread
                personId={person.id}
                personFirstName={person.firstName}
                applicationId={applicationId}
              />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function ResubmissionAttemptsNotice({
  resubmissionAttempts,
}: {
  resubmissionAttempts: { count: number; mostRecentAt: string | null };
}) {
  const { count, mostRecentAt } = resubmissionAttempts;
  return (
    <div
      role="status"
      className="flex items-start gap-2.5 rounded-lg border border-amber-200 bg-amber-50 px-3.5 py-3"
    >
      <AlertCircleIcon size={16} className="mt-px shrink-0 text-amber-600" />
      <div className="text-[13px] leading-relaxed text-amber-800">
        <span className="font-medium">
          {count} duplicate submission{count === 1 ? "" : "s"} blocked
        </span>
        {mostRecentAt && <> — most recent {formatDateTime(mostRecentAt)}</>}
        {". Original answers/documents were preserved. Staff-only visibility."}
      </div>
    </div>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline gap-2.5">
      <span className="w-18.5 shrink-0 text-[11px] text-slate-400">{label}</span>
      <span className="min-w-0 text-[13px] text-slate-700">{value}</span>
    </div>
  );
}

function ExperienceTab({
  formAnswers,
  questionnaires,
}: {
  formAnswers: Record<string, string>;
  questionnaires: QuestionnaireResponseDetail[];
}) {
  const val = (key: ApplyFieldKey) => (formAnswers[key] ?? "").trim();
  const summary = val("experience_summary");
  const workHistory = val("work_history");
  const education = val("education");
  const coverLetter = val("cover_letter");
  const detailKeys: ApplyFieldKey[] = ["address", "desired_salary"];
  const detailRows = detailKeys
    .map((k) => ({ key: k, value: val(k) }))
    .filter((r) => r.value.length > 0);

  const embedded = questionnaires.find((q) => q.context === "application_embedded");
  const embeddedAnswers = (embedded?.answers ?? []).filter(
    (a) => a.type !== "file" && a.type !== "video",
  );

  const hasAnything =
    summary ||
    workHistory ||
    education ||
    coverLetter ||
    detailRows.length > 0 ||
    embeddedAnswers.length > 0;

  if (!hasAnything) {
    return (
      <div className="flex flex-col items-center justify-center gap-1 pt-16 text-center">
        <div className="text-[13px] font-medium text-slate-600">No experience captured</div>
        <div className="max-w-80 text-xs leading-relaxed text-slate-400">
          This applicant didn’t fill in the experience fields on the application form.
        </div>
      </div>
    );
  }

  return (
    <>
      {summary && (
        <>
          <SectionLabel className="mb-2.5 tracking-[0.1em]">SUMMARY</SectionLabel>
          <p className="mb-6 whitespace-pre-line text-[13px] leading-relaxed text-slate-700">
            {summary}
          </p>
        </>
      )}

      {workHistory && (
        <>
          <SectionLabel className="mb-2.5 tracking-[0.1em]">WORK HISTORY</SectionLabel>
          <p className="mb-6 whitespace-pre-line text-[13px] leading-relaxed text-slate-700">
            {workHistory}
          </p>
        </>
      )}

      {education && (
        <>
          <SectionLabel className="mb-2.5 tracking-[0.1em]">EDUCATION</SectionLabel>
          <p className="mb-6 whitespace-pre-line text-[13px] leading-relaxed text-slate-700">
            {education}
          </p>
        </>
      )}

      {coverLetter && (
        <>
          <SectionLabel className="mb-2.5 tracking-[0.1em]">COVER LETTER</SectionLabel>
          <p className="mb-6 whitespace-pre-line text-[13px] leading-relaxed text-slate-600">
            {coverLetter}
          </p>
        </>
      )}

      {detailRows.length > 0 && (
        <>
          <SectionLabel className="mb-2.5 tracking-[0.1em]">APPLICATION DETAILS</SectionLabel>
          <div className="mb-6 flex flex-col gap-2">
            {detailRows.map((r) => (
              <div key={r.key} className="flex items-baseline justify-between gap-3">
                <span className="text-xs text-slate-500">{FIELD_LABEL[r.key]}</span>
                <span className="text-[13px] font-medium text-slate-800">{r.value}</span>
              </div>
            ))}
          </div>
        </>
      )}

      {embeddedAnswers.length > 0 && (
        <>
          <SectionLabel className="mb-1.5 tracking-[0.1em]">APPLICATION ANSWERS</SectionLabel>
          <div className="mb-3 text-[11px] text-slate-400">
            From this position’s application questionnaire.
          </div>
          <div className="flex flex-col gap-3.5">
            {embeddedAnswers.map((a) => (
              <div key={a.questionId}>
                <div className="mb-1 text-xs font-medium text-slate-700">{a.prompt}</div>
                <div className="rounded-lg border border-slate-100 bg-slate-50 px-2.75 py-2.5 text-xs leading-relaxed text-slate-500">
                  {answerText(a.value)}
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </>
  );
}

function ResumeTab({ documents }: { documents: ProfileDocument[] }) {
  const resume = documents.find((d) => d.kind === "resume") ?? null;

  if (!resume) {
    return (
      <div className="flex flex-col items-center justify-center gap-1 pt-16 text-center">
        <DocumentIcon size={22} className="text-slate-300" />
        <div className="text-[13px] font-medium text-slate-600">No resume on file</div>
        <div className="max-w-80 text-xs leading-relaxed text-slate-400">
          The applicant didn’t upload a resume, or resume upload was disabled for this position.
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="mb-3.5 flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <div className="flex h-7.5 w-7.5 shrink-0 items-center justify-center rounded-md bg-red-50 text-red-600">
            <DocumentIcon size={15} />
          </div>
          <div className="min-w-0">
            <div className="truncate text-[13px] font-medium text-slate-900">
              {resume.filename ?? "Resume"}
            </div>
            <div className="text-[11px] text-slate-400">
              Uploaded {formatDate(resume.createdAt)}
            </div>
          </div>
        </div>
        {resume.url && (
          <a
            href={resume.url}
            target="_blank"
            rel="noreferrer"
            className="inline-flex h-7 items-center rounded-md border border-slate-300 bg-white px-2.75 text-xs font-medium text-slate-800 hover:bg-slate-50"
          >
            Download
          </a>
        )}
      </div>
      <ResumePreview resume={resume} />
    </>
  );
}

const PREVIEW_FRAME = "h-160 w-full rounded-xl border border-slate-200 bg-slate-100";

function PreviewMessage({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50 p-6 text-center text-xs text-slate-400">
      {children}
    </div>
  );
}

function ResumePreview({ resume }: { resume: ProfileDocument }) {
  if (!resume.url) {
    return <PreviewMessage>Couldn’t generate a preview link for this file.</PreviewMessage>;
  }

  switch (resumePreviewKind(resume.mimeType, resume.filename)) {
    case "pdf":
      return <iframe title="Resume preview" src={resume.url} className={PREVIEW_FRAME} />;
    case "image":
      return (
        <div className={cn(PREVIEW_FRAME, "overflow-auto p-4")}>
          {/* eslint-disable-next-line @next/next/no-img-element -- a short-lived signed URL, not an optimisable asset */}
          <img src={resume.url} alt="Resume" className="mx-auto max-w-full" />
        </div>
      );
    case "docx":
      return <DocxPreview url={resume.url} className={cn(PREVIEW_FRAME, "overflow-auto")} />;
    case "none":
      return (
        <PreviewMessage>
          This file type can’t be previewed here. Use Download to open it.
        </PreviewMessage>
      );
  }
}

function DocumentsTab({ documents }: { documents: ProfileDocument[] }) {
  if (documents.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-1 pt-16 text-center">
        <DocumentIcon size={22} className="text-slate-300" />
        <div className="text-[13px] font-medium text-slate-600">No documents</div>
        <div className="max-w-80 text-xs leading-relaxed text-slate-400">
          Uploaded resumes and questionnaire file/video answers will appear here.
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {documents.map((d) => {
        const isVideo = d.kind === "video";
        return (
          <a
            key={d.id}
            href={d.url ?? "#"}
            target="_blank"
            rel="noreferrer"
            className={cn(
              "flex items-center gap-2.5 rounded-lg border border-slate-200 bg-white px-3 py-2.5 hover:border-slate-300 hover:bg-slate-50",
              !d.url && "pointer-events-none opacity-60",
            )}
          >
            <div
              className={cn(
                "flex h-8 w-8 shrink-0 items-center justify-center rounded-md",
                isVideo ? "bg-blue-50 text-blue-600" : "bg-red-50 text-red-600",
              )}
            >
              <DocumentIcon size={15} />
            </div>
            <div className="min-w-0 flex-1">
              <div className="truncate text-[13px] font-medium text-slate-900">
                {d.filename ?? (isVideo ? "Video" : "Document")}
              </div>
              <div className="mt-px flex items-center gap-1.5 text-[11px] text-slate-400">
                <span className="font-mono uppercase tracking-[0.04em]">{d.kind}</span>
                <span>·</span>
                <span>{formatDate(d.createdAt)}</span>
              </div>
            </div>
          </a>
        );
      })}
    </div>
  );
}

function QuestionnairesTab({
  applicationId,
  positionId,
  questionnaires,
  expandedQ,
  onToggle,
  onSetReminders,
  remindersBusyId,
}: {
  applicationId: string;
  positionId: string;
  questionnaires: QuestionnaireResponseDetail[];
  expandedQ: string | null;
  onToggle: (id: string) => void;
  onSetReminders: (responseId: string, stopped: boolean) => void;
  remindersBusyId: string | null;
}) {
  const resend = useResendQuestionnaire(applicationId);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ id: string; tone: "ok" | "error"; text: string } | null>(
    null,
  );
  const resendBusyId = resend.isPending ? (resend.variables ?? null) : null;

  async function resendQuestionnaire(q: QuestionnaireResponseDetail) {
    const action = questionnaireResendAction(q);
    setConfirmingId(null);
    setNotice(null);
    try {
      await resend.mutateAsync(q.id);
      setNotice({ id: q.id, tone: "ok", text: action.done });
    } catch (resendError) {
      setNotice({
        id: q.id,
        tone: "error",
        text: apiErrorMessage(resendError, "Couldn’t send the questionnaire again."),
      });
    }
  }

  const header = (
    <div className="mb-3.5 flex items-center justify-between gap-3">
      <span className="shrink-0 text-xs text-slate-500">
        {questionnaires.length} questionnaire{questionnaires.length === 1 ? "" : "s"} on record
      </span>
      <SendQuestionnaireMenu applicationId={applicationId} positionId={positionId} />
    </div>
  );

  if (questionnaires.length === 0) {
    return (
      <>
        {header}
        <div className="flex flex-col items-center justify-center gap-1 pt-12 text-center">
          <div className="text-[13px] font-medium text-slate-600">No questionnaires</div>
          <div className="max-w-80 text-xs leading-relaxed text-slate-400">
            Questionnaires sent to this candidate — and their answers — will show up here.
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      {header}
      <div className="flex flex-col gap-2.5">
        {questionnaires.map((q) => {
          const open = expandedQ === q.id;
          const complete = q.status === "completed";
          const state = questionnaireCompletionState(q, new Date());
          const action = questionnaireResendAction(q);
          const busy = resendBusyId === q.id;
          return (
            <div key={q.id} className="overflow-hidden rounded-xl border border-slate-200">
              <div
                className={cn(
                  "flex items-center gap-2 pr-3",
                  open ? "bg-slate-50" : "bg-white hover:bg-slate-50",
                )}
              >
                <button
                  type="button"
                  onClick={() => onToggle(q.id)}
                  className="flex min-w-0 flex-1 items-center gap-2.5 py-3 pl-3.5 text-left"
                >
                  <ChevronRightIcon
                    size={13}
                    className={cn("text-slate-400 transition-transform", open && "rotate-90")}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="text-[13px] font-medium text-slate-900">{q.name}</div>
                    <div className="mt-px text-[11px] text-slate-400">
                      {questionnaireTimeline(q)} · {q.questionCount} question
                      {q.questionCount === 1 ? "" : "s"}
                    </div>
                  </div>
                  <Badge
                    tone={complete ? "green" : state === "link_expired" ? "amber" : "neutral"}
                    dot
                  >
                    {complete ? "Complete" : state === "link_expired" ? "Link expired" : "Pending"}
                  </Badge>
                </button>
                <button
                  type="button"
                  disabled={resendBusyId !== null}
                  onClick={() =>
                    action.confirm ? setConfirmingId(q.id) : void resendQuestionnaire(q)
                  }
                  className="inline-flex h-6.5 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md border border-slate-300 bg-white px-2.5 text-[11px] font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-60"
                >
                  {busy && (
                    <span className="inline-block h-2.5 w-2.5 animate-[ds-spin_0.7s_linear_infinite] rounded-full border-2 border-current/30 border-t-current" />
                  )}
                  {busy ? action.busyLabel : action.label}
                </button>
              </div>

              {confirmingId === q.id && action.confirm && (
                <div className="flex flex-wrap items-center justify-between gap-2 border-t border-amber-200 bg-amber-50 px-3.5 py-2">
                  <span className="text-[11px] text-amber-800">{action.confirm}</span>
                  <span className="flex shrink-0 items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => setConfirmingId(null)}
                      className="h-6.5 rounded-md border border-slate-300 bg-white px-2.5 text-[11px] font-medium text-slate-700 hover:bg-slate-50"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={() => void resendQuestionnaire(q)}
                      className="h-6.5 rounded-md bg-accent-9 px-2.5 text-[11px] font-semibold text-white hover:bg-accent-10"
                    >
                      Send again
                    </button>
                  </span>
                </div>
              )}

              {notice?.id === q.id && (
                <div
                  className={cn(
                    "border-t px-3.5 py-2 text-[11px]",
                    notice.tone === "ok"
                      ? "border-emerald-100 bg-emerald-50 text-emerald-800"
                      : "border-red-100 bg-red-50 text-red-700",
                  )}
                >
                  {notice.text}
                </div>
              )}

              {!complete &&
                (state === "link_expired" || q.remindersStoppedAt || q.pendingReminders > 0) && (
                  <div className="flex items-center justify-between gap-2 border-t border-slate-100 bg-slate-50 px-3.5 py-2">
                    <span className="text-[11px] text-slate-500">
                      {state === "link_expired"
                        ? `Their link expired on ${formatDate(q.linkExpiresAt)}. Sending this questionnaire again issues a fresh one.`
                        : q.remindersStoppedAt
                          ? "Reminders stopped. Nothing further will be sent for this questionnaire."
                          : "Reminders keep chasing this until it is completed."}
                    </span>
                    {!q.remindersStoppedAt && q.pendingReminders > 0 && (
                      <button
                        type="button"
                        disabled={remindersBusyId === q.id}
                        onClick={() => onSetReminders(q.id, true)}
                        className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-slate-300 bg-white px-2.5 py-1 text-[11px] font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-60"
                      >
                        {remindersBusyId === q.id && (
                          <span className="inline-block h-2.5 w-2.5 animate-[ds-spin_0.7s_linear_infinite] rounded-full border-2 border-current/30 border-t-current" />
                        )}
                        {remindersBusyId === q.id ? "Stopping…" : "Stop reminders"}
                      </button>
                    )}
                  </div>
                )}
              {open && (
                <div className="flex flex-col gap-4 border-t border-slate-100 p-3.5">
                  {q.answers.length === 0 && (
                    <div className="text-xs text-slate-400">No answers recorded.</div>
                  )}
                  {q.answers.map((a) => (
                    <div key={a.questionId}>
                      <div className="mb-1.5 text-xs font-medium text-slate-700">{a.prompt}</div>
                      {a.type === "video" ? (
                        <VideoAnswer media={a.media} />
                      ) : a.type === "file" ? (
                        a.media?.url ? (
                          <a
                            href={a.media.url}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-xs text-accent-11 hover:bg-slate-50"
                          >
                            <DocumentIcon size={13} />
                            Download file
                          </a>
                        ) : (
                          <div className="text-xs text-slate-400">No file uploaded.</div>
                        )
                      ) : (
                        <div className="rounded-lg border border-slate-100 bg-slate-50 px-2.75 py-2.5 text-xs leading-relaxed text-slate-500">
                          {answerText(a.value)}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </>
  );
}

function VideoAnswer({ media }: { media: AnswerMedia | null }) {
  if (!media?.url) {
    return (
      <div className="rounded-lg bg-slate-100 px-3 py-6 text-center text-xs text-slate-400">
        No video recorded.
      </div>
    );
  }

  if (media.source === "upload") {
    return (
      <video
        controls
        src={media.url}
        className="w-full rounded-lg bg-slate-900"
        style={{ aspectRatio: "16 / 9" }}
      />
    );
  }

  return (
    <div className="flex flex-col gap-1.5">
      {media.embedUrl ? (
        <iframe
          src={media.embedUrl}
          title="Candidate video"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
          allowFullScreen
          referrerPolicy="strict-origin-when-cross-origin"
          className="w-full rounded-lg bg-slate-900"
          style={{ aspectRatio: "16 / 9" }}
        />
      ) : (
        <div className="rounded-lg bg-slate-100 px-3 py-6 text-center text-xs text-slate-400">
          This video can&apos;t be previewed here.
        </div>
      )}
      <a
        href={media.url}
        target="_blank"
        rel="noreferrer"
        className="inline-flex items-center gap-1.5 self-start text-xs text-accent-11 hover:underline"
      >
        <ExternalLinkIcon size={12} />
        Open in new tab{media.provider ? ` · ${media.provider}` : ""}
      </a>
    </div>
  );
}
