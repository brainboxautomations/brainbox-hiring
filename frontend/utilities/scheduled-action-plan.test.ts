import { describe, expect, it } from "vitest";

import {
  planScheduledAction,
  type ScheduledActionConfig,
  type ScheduledActionContext,
} from "@/utilities/scheduled-action-plan";
import type { ReminderConfig } from "@/types/api";

const POSITION = "position-1";
const ORIGIN_STAGE = "stage-1";
const OTHER_STAGE = "stage-2";
const RESPONSE = "response-1";

function reminderConfig(overrides: Partial<ReminderConfig> = {}): ReminderConfig {
  return {
    enabled: true,
    intervalMinutes: [2880],
    maxCount: 3,
    messageTemplateId: null,
    ...overrides,
  };
}

function emailAction(overrides: Partial<ScheduledActionConfig> = {}): ScheduledActionConfig {
  return {
    id: "action-1",
    type: "send_email",
    messageTemplateId: "template-1",
    questionnaireTemplateId: null,
    targetPositionStageId: null,
    targetStagePositionId: null,
    reminderConfig: null,
    ...overrides,
  };
}

function moveAction(overrides: Partial<ScheduledActionConfig> = {}): ScheduledActionConfig {
  return {
    id: "action-2",
    type: "move_to_stage",
    messageTemplateId: null,
    questionnaireTemplateId: null,
    targetPositionStageId: OTHER_STAGE,
    targetStagePositionId: POSITION,
    reminderConfig: null,
    ...overrides,
  };
}

function questionnaireAction(
  overrides: Partial<ScheduledActionConfig> = {},
): ScheduledActionConfig {
  return {
    id: "action-3",
    type: "send_questionnaire",
    messageTemplateId: null,
    questionnaireTemplateId: "questionnaire-1",
    targetPositionStageId: null,
    targetStagePositionId: null,
    reminderConfig: reminderConfig(),
    ...overrides,
  };
}

function context(overrides: Partial<ScheduledActionContext> = {}): ScheduledActionContext {
  return {
    kind: "stage_action",
    originStageId: ORIGIN_STAGE,
    application: {
      id: "application-1",
      positionId: POSITION,
      currentStageId: ORIGIN_STAGE,
      archived: false,
      positionStatus: "open",
    },
    action: emailAction(),
    questionnaire: null,
    reminderNumber: null,
    ...overrides,
  };
}

function reminderContext(overrides: Partial<ScheduledActionContext> = {}): ScheduledActionContext {
  return context({
    kind: "reminder",
    action: questionnaireAction(),
    questionnaire: {
      id: RESPONSE,
      completed: false,
      remindersStopped: false,
      reminderConfig: null,
    },
    reminderNumber: 1,
    ...overrides,
  });
}

function routingContext(overrides: Partial<ScheduledActionContext> = {}): ScheduledActionContext {
  return context({
    kind: "answer_routing",
    action: null,
    questionnaire: { id: RESPONSE, completed: true, remindersStopped: false, reminderConfig: null },
    ...overrides,
  });
}

describe("a due action that is still valid runs", () => {
  it("sends the email its template names", () => {
    expect(planScheduledAction(context())).toEqual({
      kind: "send_email",
      messageTemplateId: "template-1",
    });
  });

  it("moves the candidate to the target stage", () => {
    const plan = planScheduledAction(context({ action: moveAction() }));
    expect(plan).toEqual({ kind: "move_to_stage", targetPositionStageId: OTHER_STAGE });
  });

  it("sends the questionnaire its action names", () => {
    const plan = planScheduledAction(context({ action: questionnaireAction() }));
    expect(plan).toEqual({
      kind: "send_questionnaire",
      questionnaireTemplateId: "questionnaire-1",
    });
  });
});

describe("the stage is re-checked at execution time, not at schedule time", () => {
  it("skips when the candidate has moved on since the action was queued", () => {
    const plan = planScheduledAction(
      context({
        application: {
          id: "application-1",
          positionId: POSITION,
          currentStageId: OTHER_STAGE,
          archived: false,
          positionStatus: "open",
        },
      }),
    );

    expect(plan).toEqual({
      kind: "skip",
      reason: "The candidate is no longer in the stage that scheduled this action",
    });
  });

  it("skips when the candidate is in no stage at all", () => {
    const plan = planScheduledAction(
      context({
        application: {
          id: "application-1",
          positionId: POSITION,
          currentStageId: null,
          archived: false,
          positionStatus: "open",
        },
      }),
    );

    expect(plan.kind).toBe("skip");
  });

  it("skips when the originating stage has been deleted", () => {
    const plan = planScheduledAction(context({ originStageId: null }));

    expect(plan).toEqual({
      kind: "skip",
      reason: "The stage this action was scheduled from no longer exists",
    });
  });

  it("reports the move rather than the missing stage when both are true", () => {
    const plan = planScheduledAction(
      context({
        application: {
          id: "application-1",
          positionId: POSITION,
          currentStageId: OTHER_STAGE,
          archived: false,
          positionStatus: "open",
        },
        action: emailAction({ messageTemplateId: null }),
      }),
    );

    expect(plan).toEqual({
      kind: "skip",
      reason: "The candidate is no longer in the stage that scheduled this action",
    });
  });

  it("does not send to a candidate who has been archived", () => {
    const plan = planScheduledAction(
      context({
        application: {
          id: "application-1",
          positionId: POSITION,
          currentStageId: ORIGIN_STAGE,
          archived: true,
          positionStatus: "open",
        },
      }),
    );

    expect(plan).toEqual({ kind: "skip", reason: "The candidate has been archived" });
  });
});

describe("a configuration that has been deleted underneath the queued row", () => {
  it("skips when the stage action itself is gone", () => {
    const plan = planScheduledAction(context({ action: null }));

    expect(plan).toEqual({
      kind: "skip",
      reason: "The stage action was deleted before it came due",
    });
  });

  it("skips when the email template has been deleted", () => {
    const plan = planScheduledAction(context({ action: emailAction({ messageTemplateId: null }) }));

    expect(plan).toEqual({
      kind: "skip",
      reason: "The email template this action sends has been deleted",
    });
  });

  it("skips when the questionnaire has been deleted", () => {
    const plan = planScheduledAction(
      context({ action: questionnaireAction({ questionnaireTemplateId: null }) }),
    );

    expect(plan).toEqual({
      kind: "skip",
      reason: "The questionnaire this action sends has been deleted",
    });
  });

  it("skips when the target stage has been deleted", () => {
    const plan = planScheduledAction(
      context({ action: moveAction({ targetPositionStageId: null, targetStagePositionId: null }) }),
    );

    expect(plan).toEqual({
      kind: "skip",
      reason: "The stage this action moves the candidate to has been deleted",
    });
  });

  it("never guesses a stage when the target belongs to another position", () => {
    const plan = planScheduledAction(
      context({ action: moveAction({ targetStagePositionId: "position-2" }) }),
    );

    expect(plan).toEqual({
      kind: "skip",
      reason: "The stage this action moves the candidate to belongs to a different position",
    });
  });
});

describe("a due reminder re-checks every stop condition before it sends", () => {
  it("sends when nothing has stopped it", () => {
    expect(planScheduledAction(reminderContext())).toEqual({
      kind: "send_reminder",
      questionnaireResponseId: RESPONSE,
      reminderNumber: 1,
    });
  });

  it("stops once the questionnaire is completed", () => {
    const plan = planScheduledAction(
      reminderContext({
        questionnaire: {
          id: RESPONSE,
          completed: true,
          remindersStopped: false,
          reminderConfig: null,
        },
      }),
    );

    expect(plan).toEqual({
      kind: "skip",
      reason: "The questionnaire has already been completed",
    });
  });

  it("stops when a user has stopped reminders by hand", () => {
    const plan = planScheduledAction(
      reminderContext({
        questionnaire: {
          id: RESPONSE,
          completed: false,
          remindersStopped: true,
          reminderConfig: null,
        },
      }),
    );

    expect(plan).toEqual({
      kind: "skip",
      reason: "Reminders were stopped for this questionnaire",
    });
  });

  it("stops when the candidate has moved to another stage", () => {
    const plan = planScheduledAction(
      reminderContext({
        application: {
          id: "application-1",
          positionId: POSITION,
          currentStageId: OTHER_STAGE,
          archived: false,
          positionStatus: "open",
        },
      }),
    );

    expect(plan).toEqual({
      kind: "skip",
      reason: "The candidate is no longer in the stage that scheduled this action",
    });
  });

  it("stops when this reminder is past the configured maximum count", () => {
    const plan = planScheduledAction(
      reminderContext({
        action: questionnaireAction({ reminderConfig: reminderConfig({ maxCount: 2 }) }),
        reminderNumber: 3,
      }),
    );

    expect(plan).toEqual({
      kind: "skip",
      reason: "The reminder schedule no longer includes this reminder",
    });
  });

  it("stops when reminders have been turned off on the action since scheduling", () => {
    const plan = planScheduledAction(
      reminderContext({
        action: questionnaireAction({ reminderConfig: reminderConfig({ enabled: false }) }),
      }),
    );

    expect(plan.kind).toBe("skip");
  });

  it("reports completion rather than the stage move when both are true", () => {
    const plan = planScheduledAction(
      reminderContext({
        questionnaire: {
          id: RESPONSE,
          completed: true,
          remindersStopped: false,
          reminderConfig: null,
        },
        application: {
          id: "application-1",
          positionId: POSITION,
          currentStageId: OTHER_STAGE,
          archived: false,
          positionStatus: "open",
        },
      }),
    );

    expect(plan).toEqual({
      kind: "skip",
      reason: "The questionnaire has already been completed",
    });
  });

  it("skips when the questionnaire response itself has gone", () => {
    const plan = planScheduledAction(reminderContext({ questionnaire: null }));

    expect(plan).toEqual({
      kind: "skip",
      reason: "The questionnaire this reminder chases no longer exists",
    });
  });

  it("skips when the questionnaire action that sent it was deleted", () => {
    const plan = planScheduledAction(reminderContext({ action: null }));

    expect(plan).toEqual({
      kind: "skip",
      reason: "The stage action that sent this questionnaire was deleted",
    });
  });
});

describe("a queued routing evaluation", () => {
  it("routes when the response is still complete and the candidate has not moved", () => {
    expect(planScheduledAction(routingContext())).toEqual({
      kind: "route_answers",
      questionnaireResponseId: RESPONSE,
    });
  });

  it("skips when the response is no longer marked complete", () => {
    const plan = planScheduledAction(
      routingContext({
        questionnaire: {
          id: RESPONSE,
          completed: false,
          remindersStopped: false,
          reminderConfig: null,
        },
      }),
    );

    expect(plan).toEqual({
      kind: "skip",
      reason: "The questionnaire is no longer marked complete",
    });
  });

  it("skips when a human moved the candidate first", () => {
    const plan = planScheduledAction(
      routingContext({
        application: {
          id: "application-1",
          positionId: POSITION,
          currentStageId: OTHER_STAGE,
          archived: false,
          positionStatus: "open",
        },
      }),
    );

    expect(plan).toEqual({
      kind: "skip",
      reason: "The candidate is no longer in the stage that scheduled this action",
    });
  });

  it("does not route an archived candidate", () => {
    const plan = planScheduledAction(
      routingContext({
        application: {
          id: "application-1",
          positionId: POSITION,
          currentStageId: ORIGIN_STAGE,
          archived: true,
          positionStatus: "open",
        },
      }),
    );

    expect(plan).toEqual({ kind: "skip", reason: "The candidate has been archived" });
  });
});

describe("a closed or archived position pauses every automation", () => {
  function onPosition(positionStatus: "closed" | "archived") {
    return {
      id: "application-1",
      positionId: POSITION,
      currentStageId: ORIGIN_STAGE,
      archived: false,
      positionStatus,
    };
  }

  it("does not send a stage email while the position is closed", () => {
    expect(planScheduledAction(context({ application: onPosition("closed") }))).toEqual({
      kind: "skip",
      reason: "The position is closed",
    });
  });

  it("does not send a questionnaire while the position is closed", () => {
    const plan = planScheduledAction(
      context({ action: questionnaireAction(), application: onPosition("closed") }),
    );
    expect(plan).toEqual({ kind: "skip", reason: "The position is closed" });
  });

  it("does not send a questionnaire reminder while the position is closed", () => {
    expect(planScheduledAction(reminderContext({ application: onPosition("closed") }))).toEqual({
      kind: "skip",
      reason: "The position is closed",
    });
  });

  it("does not email anyone on an archived position", () => {
    expect(planScheduledAction(context({ application: onPosition("archived") }))).toEqual({
      kind: "skip",
      reason: "The position is archived",
    });
  });

  // The Status card promises "nobody is moved, rejected or emailed".
  it("does not move the candidate automatically while the position is closed", () => {
    const plan = planScheduledAction(
      context({ action: moveAction(), application: onPosition("closed") }),
    );
    expect(plan).toEqual({ kind: "skip", reason: "The position is closed" });
  });

  it("does not route completed answers while the position is closed", () => {
    const plan = planScheduledAction(routingContext({ application: onPosition("closed") }));
    expect(plan).toEqual({ kind: "skip", reason: "The position is closed" });
  });

  it("runs every automation again once the position is open", () => {
    const open = { ...onPosition("closed"), positionStatus: "open" as const };
    expect(planScheduledAction(context({ action: moveAction(), application: open }))).toEqual({
      kind: "move_to_stage",
      targetPositionStageId: OTHER_STAGE,
    });
  });
});
