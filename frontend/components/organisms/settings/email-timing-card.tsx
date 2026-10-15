"use client";

import { useState, type FormEvent } from "react";

import { Button } from "@/components/atoms/button";
import { Card, SectionLabel } from "@/components/atoms/card";
import { Field, Input } from "@/components/atoms/input";
import { ErrorAlert } from "@/components/molecules/error-alert";
import { LoadingBlock } from "@/components/organisms/settings/section-parts";
import { useEmailTiming, useSaveEmailTiming } from "@/hooks/use-settings";
import { emailTimingSchema } from "@/schemas/settings-schema";
import type { EmailTimingSettings } from "@/types/api";
import { apiErrorMessage } from "@/utilities/api-error";

/**
 * The two safety windows against a slip of the hand (migration 0054): how long
 * automated emails wait after a candidate enters a stage, and how long an email
 * a person sends is held with Undo and Send now. 0 turns either off.
 */
export function EmailTimingCard() {
  const { data, isPending, isError, error } = useEmailTiming();

  if (isPending) return <LoadingBlock rows={2} />;
  if (isError) {
    return (
      <ErrorAlert
        title="Could not load the email timing"
        message={apiErrorMessage(error, "Something went wrong reading the email timing.")}
      />
    );
  }

  return <EmailTimingForm initial={data} />;
}

/** Starts from the saved values; mounted once they have loaded. */
function EmailTimingForm({ initial }: { initial: EmailTimingSettings }) {
  const save = useSaveEmailTiming();
  const [safety, setSafety] = useState(String(initial.automationSafetyDelayMinutes));
  const [undo, setUndo] = useState(String(initial.sendUndoMinutes));
  const [formError, setFormError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setSaved(false);
    const parsed = emailTimingSchema.safeParse({
      automationSafetyDelayMinutes: Number(safety),
      sendUndoMinutes: Number(undo),
    });
    if (!parsed.success || safety.trim() === "" || undo.trim() === "") {
      setFormError(parsed.error?.issues[0]?.message ?? "Enter both values in minutes");
      return;
    }
    setFormError(null);
    try {
      await save.mutateAsync(parsed.data);
      setSaved(true);
    } catch (saveError) {
      setFormError(apiErrorMessage(saveError, "Couldn’t save the email timing."));
    }
  }

  return (
    <Card className="overflow-hidden">
      <div className="border-b border-slate-200 bg-slate-50 px-4 py-2.5">
        <SectionLabel>Safety delays</SectionLabel>
      </div>
      <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4 px-4 py-4">
        <Field
          label="Automation safety delay (minutes)"
          htmlFor="automation-safety-delay"
          hint="Automated emails and questionnaires wait at least this long after a candidate enters a stage. Moving them out in time cancels it. 0 turns it off."
        >
          <Input
            id="automation-safety-delay"
            inputMode="numeric"
            value={safety}
            onChange={(e) => {
              setSafety(e.target.value);
              setSaved(false);
            }}
            className="max-w-32"
          />
        </Field>

        <Field
          label="Undo window for sent emails (minutes)"
          htmlFor="send-undo-window"
          hint="An email you send (one at a time or in bulk) is held this long, with Undo and Send now. Questionnaire invites always go at once. 0 turns it off."
        >
          <Input
            id="send-undo-window"
            inputMode="numeric"
            value={undo}
            onChange={(e) => {
              setUndo(e.target.value);
              setSaved(false);
            }}
            className="max-w-32"
          />
        </Field>

        {formError && <p className="text-[11px] text-red-700">{formError}</p>}

        <div className="flex items-center gap-3">
          <Button type="submit" variant="primary" loading={save.isPending}>
            Save
          </Button>
          {saved && <span className="text-xs text-slate-500">Saved</span>}
        </div>
      </form>
    </Card>
  );
}
