import type { Metadata } from "next";

import { getHostedQuestionnaire, getHostedQuestionnaireState } from "../_data";
import { HostedQuestionnaireForm } from "./hosted-questionnaire-form";
import { QuestionnaireNotice } from "./questionnaire-notice";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ token: string }> };

export const metadata: Metadata = {
  title: "Questionnaire",
  robots: { index: false, follow: false },
};

function LinkNotValid() {
  return (
    <QuestionnaireNotice tone="neutral" title="This link is not valid">
      We could not find a questionnaire for this link. Check that you copied the whole address from
      our email, or reply to that email and we will send you a fresh one.
    </QuestionnaireNotice>
  );
}

function LinkExpired() {
  return (
    <QuestionnaireNotice tone="warning" title="This link has expired">
      Questionnaire links stop working after a while, and a newer email replaces the link in an
      older one. Open the most recent message we sent you, or reply to it and we will send a fresh
      link.
    </QuestionnaireNotice>
  );
}

function AlreadyCompleted() {
  return (
    <QuestionnaireNotice tone="success" title="You have already completed this">
      Your answers are with the hiring team and this link is closed. There is nothing more to do —
      we will be in touch by email about next steps.
    </QuestionnaireNotice>
  );
}

export default async function HostedQuestionnairePage({ params }: Params) {
  const { token } = await params;

  const state = await getHostedQuestionnaireState(token);

  if (state === "expired") return <LinkExpired />;
  if (state === "completed") return <AlreadyCompleted />;
  if (state === "unknown") return <LinkNotValid />;

  const questionnaire = await getHostedQuestionnaire(token);
  if (!questionnaire) return <LinkNotValid />;

  return <HostedQuestionnaireForm token={token} questionnaire={questionnaire} />;
}
