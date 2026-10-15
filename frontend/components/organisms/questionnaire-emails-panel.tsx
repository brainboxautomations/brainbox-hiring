"use client";

import { QuestionnaireEmailFields } from "@/components/organisms/questionnaire-email-fields";
import { useQuestionnaireEmails } from "@/hooks/use-settings";
import type { QuestionnaireEmailChoice } from "@/types/api";
import { cn } from "@/utilities/cn";
import {
  ORIGINAL_QUESTIONNAIRE_EMAILS,
  type QuestionnaireEmailKind,
} from "@/utilities/questionnaire-email";

const KINDS: { kind: QuestionnaireEmailKind; title: string }[] = [
  { kind: "invite", title: "Invite email" },
  { kind: "reminder", title: "Reminder email" },
];

/**
 * Whether this questionnaire's invite and reminder use the default wording
 * from Settings or its own. Custom wording starts from the default, and is
 * kept while "Use default" is picked, so switching back brings it back.
 */
export function QuestionnaireEmailsPanel({
  inviteEmail,
  reminderEmail,
  onChange,
}: {
  inviteEmail: QuestionnaireEmailChoice;
  reminderEmail: QuestionnaireEmailChoice;
  onChange: (kind: QuestionnaireEmailKind, choice: QuestionnaireEmailChoice) => void;
}) {
  const defaults = useQuestionnaireEmails();
  const fallback = defaults.data ?? ORIGINAL_QUESTIONNAIRE_EMAILS;
  const choices = { invite: inviteEmail, reminder: reminderEmail };

  function switchToCustom(kind: QuestionnaireEmailKind) {
    const choice = choices[kind];
    onChange(kind, {
      mode: "custom",
      subject: choice.subject?.trim() ? choice.subject : fallback[kind].subject,
      body: choice.body?.trim() ? choice.body : fallback[kind].body,
    });
  }

  return (
    <div className="flex flex-col gap-4">
      {KINDS.map(({ kind, title }) => {
        const choice = choices[kind];
        const custom = choice.mode === "custom";
        return (
          <div key={kind}>
            <div className="mb-2 flex items-center justify-between gap-3">
              <span className="text-xs font-medium text-slate-700">{title}</span>
              <div
                role="radiogroup"
                aria-label={title}
                className="inline-flex rounded-lg border border-slate-200 bg-slate-50 p-0.5"
              >
                {(["default", "custom"] as const).map((mode) => {
                  const active = choice.mode === mode;
                  return (
                    <button
                      key={mode}
                      type="button"
                      role="radio"
                      aria-checked={active}
                      onClick={() =>
                        mode === "custom"
                          ? switchToCustom(kind)
                          : onChange(kind, { ...choice, mode })
                      }
                      className={cn(
                        "rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors",
                        active
                          ? "bg-white text-slate-900 shadow-sm"
                          : "text-slate-500 hover:text-slate-800",
                      )}
                    >
                      {mode === "default" ? "Use default" : "Custom"}
                    </button>
                  );
                })}
              </div>
            </div>

            {custom ? (
              <QuestionnaireEmailFields
                idPrefix={`questionnaire-${kind}`}
                value={{ subject: choice.subject ?? "", body: choice.body ?? "" }}
                onChange={(value) => onChange(kind, { mode: "custom", ...value })}
              />
            ) : (
              <>
                <p className="mb-1.5 text-[11px] leading-relaxed text-slate-500">
                  Uses the default from Settings → Questionnaire emails.
                </p>
                <QuestionnaireEmailFields
                  idPrefix={`questionnaire-${kind}-default`}
                  value={fallback[kind]}
                  onChange={() => {}}
                  readOnly
                />
              </>
            )}
          </div>
        );
      })}
    </div>
  );
}
