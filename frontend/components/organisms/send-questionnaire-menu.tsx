"use client";

import { useRef, useState } from "react";

import { Button } from "@/components/atoms/button";
import { CheckboxIndicator } from "@/components/atoms/checkbox";
import { PlusIcon } from "@/components/atoms/icons";
import { FloatingMenu } from "@/components/molecules/floating-menu";
import { useBulkSendQuestionnaire } from "@/hooks/use-candidates";
import { useQuestionnaires } from "@/hooks/use-questionnaires";
import { apiErrorMessage } from "@/utilities/api-error";
import { reminderScheduleDays } from "@/utilities/reminder-plan";
import { DEFAULT_REMINDER } from "@/utilities/stage-action-form";

const REMINDER_DAYS = reminderScheduleDays(DEFAULT_REMINDER);

function reminderScheduleSentence(): string {
  if (REMINDER_DAYS.length === 0) return "No reminders are scheduled.";
  return `Chase on ${REMINDER_DAYS.map((day) => `day ${day}`).join(", ")} until they answer.`;
}

type Outcome = { tone: "ok" | "error"; text: string } | null;

/**
 * "Send questionnaire" on a candidate's profile: pick one and it goes to this
 * candidate at once, through the same send as the board's bulk action.
 */
export function SendQuestionnaireMenu({
  applicationId,
  positionId,
}: {
  applicationId: string;
  positionId: string;
}) {
  const anchorRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [sendReminders, setSendReminders] = useState(true);
  const [outcome, setOutcome] = useState<Outcome>(null);
  const questionnaires = useQuestionnaires();
  const send = useBulkSendQuestionnaire(positionId);

  async function sendQuestionnaire(questionnaireTemplateId: string) {
    setOpen(false);
    setOutcome(null);
    try {
      const result = await send.mutateAsync({
        applicationIds: [applicationId],
        questionnaireTemplateId,
        sendReminders,
      });
      const failure = result.failures[0];
      setOutcome(
        failure
          ? { tone: "error", text: failure.reason }
          : { tone: "ok", text: "Questionnaire sent" },
      );
    } catch (sendError) {
      setOutcome({
        tone: "error",
        text: apiErrorMessage(sendError, "Couldn’t send the questionnaire."),
      });
    }
  }

  const list = questionnaires.data ?? [];

  return (
    <div className="flex min-w-0 items-center gap-2.5">
      {outcome && (
        <span
          title={outcome.text}
          className={
            outcome.tone === "ok"
              ? "truncate text-[11px] text-emerald-700"
              : "truncate text-[11px] text-red-600"
          }
        >
          {outcome.text}
        </span>
      )}
      <Button
        ref={anchorRef}
        variant="primary"
        size="sm"
        leadingIcon={<PlusIcon size={13} />}
        loading={send.isPending}
        disabled={send.isPending}
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-haspopup="menu"
      >
        Send questionnaire
      </Button>

      <FloatingMenu open={open} onClose={() => setOpen(false)} anchorRef={anchorRef} align="end">
        <div className="flex max-h-[min(32rem,var(--floating-max-height,calc(100dvh-9rem)))] w-80 flex-col rounded-xl border border-slate-200 bg-white p-1.5 shadow-modal">
          {questionnaires.isPending ? (
            <div className="px-2.5 py-3 text-xs text-slate-500">Loading questionnaires…</div>
          ) : list.length === 0 ? (
            <div className="px-2.5 py-3 text-xs leading-relaxed text-slate-500">
              There are no questionnaires yet. Build one under Questionnaires first.
            </div>
          ) : (
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
              <div role="menu" className="min-h-0 flex-1 overflow-y-auto">
                {list.map((questionnaire) => (
                  <button
                    key={questionnaire.id}
                    type="button"
                    role="menuitem"
                    onClick={() => void sendQuestionnaire(questionnaire.id)}
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
                If this questionnaire is already waiting for them, they get a fresh link. If they
                have completed it, use Send again on its card instead.
              </div>
            </>
          )}
        </div>
      </FloatingMenu>
    </div>
  );
}
