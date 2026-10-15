"use client";

import { useState, type FormEvent } from "react";

import { Button } from "@/components/atoms/button";
import { Card, SectionLabel } from "@/components/atoms/card";
import { ErrorAlert } from "@/components/molecules/error-alert";
import { QuestionnaireEmailFields } from "@/components/organisms/questionnaire-email-fields";
import {
  InfoNote,
  LoadingBlock,
  SectionHeading,
} from "@/components/organisms/settings/section-parts";
import { useQuestionnaireEmails, useSaveQuestionnaireEmails } from "@/hooks/use-settings";
import { questionnaireEmailSettingsSchema } from "@/schemas/questionnaire-schema";
import type { QuestionnaireEmailSettings, QuestionnaireEmailText } from "@/types/api";
import { apiErrorMessage } from "@/utilities/api-error";
import {
  ORIGINAL_QUESTIONNAIRE_EMAILS,
  type QuestionnaireEmailKind,
} from "@/utilities/questionnaire-email";

const BLOCKS: { kind: QuestionnaireEmailKind; title: string; hint: string }[] = [
  {
    kind: "invite",
    title: "Invite email",
    hint: "Sent with the questionnaire link, by a stage automation or a bulk send.",
  },
  {
    kind: "reminder",
    title: "Reminder email",
    hint: "Sent when a candidate has not finished the questionnaire yet.",
  },
];

export function QuestionnaireEmailsSection() {
  return (
    <>
      <SectionHeading
        title="Questionnaire emails"
        description="The default wording for the email that sends a questionnaire and the reminder that chases it."
      />

      <InfoNote className="mb-3.5">
        Each questionnaire uses these unless it is set to its own wording, under Emails in the
        questionnaire editor.
      </InfoNote>

      <QuestionnaireEmailsCard />
    </>
  );
}

function QuestionnaireEmailsCard() {
  const { data, isPending, isError, error } = useQuestionnaireEmails();

  if (isPending) return <LoadingBlock rows={4} />;
  if (isError) {
    return (
      <ErrorAlert
        title="Could not load the questionnaire emails"
        message={apiErrorMessage(error, "Something went wrong reading the questionnaire emails.")}
      />
    );
  }

  return <QuestionnaireEmailsForm initial={data} />;
}

/** Starts from the saved wording; mounted once it has loaded. */
function QuestionnaireEmailsForm({ initial }: { initial: QuestionnaireEmailSettings }) {
  const save = useSaveQuestionnaireEmails();
  const [emails, setEmails] = useState<QuestionnaireEmailSettings>(initial);
  const [formError, setFormError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  function update(kind: QuestionnaireEmailKind, value: QuestionnaireEmailText) {
    setEmails((current) => ({ ...current, [kind]: value }));
    setSaved(false);
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setSaved(false);
    const parsed = questionnaireEmailSettingsSchema.safeParse(emails);
    if (!parsed.success) {
      setFormError(parsed.error.issues[0]?.message ?? "Fill in both emails");
      return;
    }
    setFormError(null);
    try {
      await save.mutateAsync(parsed.data);
      setSaved(true);
    } catch (saveError) {
      setFormError(apiErrorMessage(saveError, "Couldn’t save the questionnaire emails."));
    }
  }

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-3.5">
      {BLOCKS.map((block) => (
        <Card key={block.kind} className="overflow-hidden">
          <div className="flex items-center justify-between gap-3 border-b border-slate-200 bg-slate-50 px-4 py-2.5">
            <SectionLabel>{block.title}</SectionLabel>
            <button
              type="button"
              onClick={() => update(block.kind, ORIGINAL_QUESTIONNAIRE_EMAILS[block.kind])}
              className="text-[11px] font-medium text-slate-500 hover:text-slate-800 hover:underline"
            >
              Reset to original wording
            </button>
          </div>
          <div className="px-4 py-4">
            <p className="mb-3 text-[11px] leading-relaxed text-slate-500">{block.hint}</p>
            <QuestionnaireEmailFields
              idPrefix={`settings-${block.kind}`}
              value={emails[block.kind]}
              onChange={(value) => update(block.kind, value)}
            />
          </div>
        </Card>
      ))}

      {formError && <p className="text-[11px] text-red-700">{formError}</p>}

      <div className="flex items-center gap-3">
        <Button type="submit" variant="primary" loading={save.isPending}>
          Save
        </Button>
        {saved && <span className="text-xs text-slate-500">Saved</span>}
      </div>
    </form>
  );
}
