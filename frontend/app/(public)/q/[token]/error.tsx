"use client";

import { Button } from "@/components/atoms/button";
import { QuestionnaireNotice } from "./questionnaire-notice";

export default function HostedQuestionnaireError({ reset }: { reset: () => void }) {
  return (
    <QuestionnaireNotice tone="warning" title="We could not load your questionnaire">
      <p>
        Something went wrong at our end — your link is probably fine. Try again in a moment, and if
        it keeps happening, reply to the email that brought you here.
      </p>
      <Button variant="secondary" onClick={reset} className="mt-5">
        Try again
      </Button>
    </QuestionnaireNotice>
  );
}
