import type { QuestionnaireResponseDetail } from "@/types/api";

export type QuestionnaireResendAction = {
  label: "Resend" | "Send again";
  busyLabel: string;
  /** Sending again asks a candidate who has finished it to fill it in once more. */
  confirm: string | null;
  done: string;
};

/** What the button on a questionnaire card does: resend a pending one, or ask again after a completed one. */
export function questionnaireResendAction(
  questionnaire: Pick<QuestionnaireResponseDetail, "status">,
): QuestionnaireResendAction {
  if (questionnaire.status === "completed") {
    return {
      label: "Send again",
      busyLabel: "Sending…",
      confirm:
        "Ask them to fill this in again? They get a new email and link; their answers here stay on record.",
      done: "Sent again. It shows as a new questionnaire.",
    };
  }

  return {
    label: "Resend",
    busyLabel: "Resending…",
    confirm: null,
    done: "Resent with a fresh link. The old link no longer works.",
  };
}
