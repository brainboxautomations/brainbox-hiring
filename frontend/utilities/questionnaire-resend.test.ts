import { describe, expect, it } from "vitest";

import { questionnaireResendAction } from "@/utilities/questionnaire-resend";

describe("questionnaireResendAction", () => {
  it("resends a pending questionnaire straight away", () => {
    const action = questionnaireResendAction({ status: "pending" });

    expect(action.label).toBe("Resend");
    expect(action.confirm).toBeNull();
    expect(action.done).toContain("fresh link");
  });

  it("asks before sending a completed one again, and says the answers are kept", () => {
    const action = questionnaireResendAction({ status: "completed" });

    expect(action.label).toBe("Send again");
    expect(action.confirm).toContain("answers here stay on record");
    expect(action.done).toContain("new questionnaire");
  });
});
