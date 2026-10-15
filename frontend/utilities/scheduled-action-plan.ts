import type {
  PositionStatus,
  ReminderConfig,
  ScheduledActionKind,
  StageActionType,
} from "@/types/api";
import { isReminderNumberWithinConfig } from "@/utilities/reminder-plan";

export type ScheduledActionApplication = {
  id: string;
  positionId: string;
  currentStageId: string | null;
  archived: boolean;
  positionStatus: PositionStatus;
};

export type ScheduledActionConfig = {
  id: string;
  type: StageActionType;
  messageTemplateId: string | null;
  questionnaireTemplateId: string | null;
  targetPositionStageId: string | null;
  targetStagePositionId: string | null;
  reminderConfig: ReminderConfig | null;
};

export type ScheduledActionQuestionnaire = {
  id: string;
  completed: boolean;
  remindersStopped: boolean;
  reminderConfig: ReminderConfig | null;
};

export type ScheduledActionContext = {
  kind: ScheduledActionKind;
  originStageId: string | null;
  application: ScheduledActionApplication;
  action: ScheduledActionConfig | null;
  questionnaire: ScheduledActionQuestionnaire | null;
  reminderNumber: number | null;
};

export type ScheduledActionPlan =
  | { kind: "send_email"; messageTemplateId: string }
  | { kind: "send_questionnaire"; questionnaireTemplateId: string }
  | { kind: "move_to_stage"; targetPositionStageId: string }
  | { kind: "send_reminder"; questionnaireResponseId: string; reminderNumber: number }
  | { kind: "route_answers"; questionnaireResponseId: string }
  | { kind: "skip"; reason: string };

function skip(reason: string): ScheduledActionPlan {
  return { kind: "skip", reason };
}

/**
 * Why no automation may run for this position's candidates, or null when it may.
 *
 * Closing a position pauses it, as its Status card promises: "nobody is moved,
 * rejected or emailed". No stage email, questionnaire, reminder, automatic move
 * or answer routing runs while it is closed, and an archived role is over. Only
 * automations are planned here, so recruiters can still move candidates by
 * hand, and "email all candidates on this position" can announce the close.
 */
function positionHold(application: ScheduledActionApplication): string | null {
  if (application.positionStatus === "closed") return "The position is closed";
  if (application.positionStatus === "archived") return "The position is archived";
  return null;
}

function planStageAction(context: ScheduledActionContext): ScheduledActionPlan {
  const { application, action } = context;

  if (!action) {
    return skip("The stage action was deleted before it came due");
  }

  if (application.currentStageId !== context.originStageId) {
    return skip("The candidate is no longer in the stage that scheduled this action");
  }

  if (application.archived) {
    return skip("The candidate has been archived");
  }

  const hold = positionHold(application);
  if (hold) return skip(hold);

  if (action.type === "send_email") {
    if (!action.messageTemplateId) {
      return skip("The email template this action sends has been deleted");
    }
    return { kind: "send_email", messageTemplateId: action.messageTemplateId };
  }

  if (action.type === "move_to_stage") {
    if (!action.targetPositionStageId) {
      return skip("The stage this action moves the candidate to has been deleted");
    }
    if (action.targetStagePositionId !== application.positionId) {
      return skip("The stage this action moves the candidate to belongs to a different position");
    }
    return { kind: "move_to_stage", targetPositionStageId: action.targetPositionStageId };
  }

  if (!action.questionnaireTemplateId) {
    return skip("The questionnaire this action sends has been deleted");
  }

  return { kind: "send_questionnaire", questionnaireTemplateId: action.questionnaireTemplateId };
}

function planReminder(context: ScheduledActionContext): ScheduledActionPlan {
  const { application, action, questionnaire, reminderNumber } = context;

  if (!questionnaire) {
    return skip("The questionnaire this reminder chases no longer exists");
  }

  if (questionnaire.completed) {
    return skip("The questionnaire has already been completed");
  }

  if (questionnaire.remindersStopped) {
    return skip("Reminders were stopped for this questionnaire");
  }

  const reminderConfig = action ? action.reminderConfig : questionnaire.reminderConfig;

  if (!action && !questionnaire.reminderConfig) {
    return skip("The stage action that sent this questionnaire was deleted");
  }

  if (!reminderNumber || !isReminderNumberWithinConfig(reminderConfig, reminderNumber)) {
    return skip("The reminder schedule no longer includes this reminder");
  }

  if (application.currentStageId !== context.originStageId) {
    return skip("The candidate is no longer in the stage that scheduled this action");
  }

  if (application.archived) {
    return skip("The candidate has been archived");
  }

  const hold = positionHold(application);
  if (hold) return skip(hold);

  return { kind: "send_reminder", questionnaireResponseId: questionnaire.id, reminderNumber };
}

function planAnswerRoutingAction(context: ScheduledActionContext): ScheduledActionPlan {
  const { application, questionnaire } = context;

  if (!questionnaire) {
    return skip("The questionnaire response this routing was queued for no longer exists");
  }

  if (!questionnaire.completed) {
    return skip("The questionnaire is no longer marked complete");
  }

  if (application.currentStageId !== context.originStageId) {
    return skip("The candidate is no longer in the stage that scheduled this action");
  }

  if (application.archived) {
    return skip("The candidate has been archived");
  }

  const hold = positionHold(application);
  if (hold) return skip(hold);

  return { kind: "route_answers", questionnaireResponseId: questionnaire.id };
}

export function planScheduledAction(context: ScheduledActionContext): ScheduledActionPlan {
  if (!context.originStageId) {
    return skip("The stage this action was scheduled from no longer exists");
  }

  if (context.kind === "reminder") return planReminder(context);
  if (context.kind === "answer_routing") return planAnswerRoutingAction(context);

  return planStageAction(context);
}
