export type PositionStatus = "draft" | "open" | "closed" | "archived";
export type PublishMode = "listed" | "unlisted" | "disabled";
export type SalaryPeriod = "year" | "month";

export type PositionLocation = { country: string; detail?: string };

export type FieldSetting = "required" | "optional" | "disabled";
export type ApplicationFormConfig = Record<string, FieldSetting>;

export type PipelineStage = {
  id: string;
  name: string;
  sortOrder: number;
};

export type Pipeline = {
  id: string;
  name: string;
  isTemplate: boolean;

  usageCount: number;
  createdAt: string;
  stages: PipelineStage[];
};

export type PipelineStageInput = {
  /** Set for a stage that already exists, so an edit updates it in place. */
  id?: string;
  name: string;
};

export type PipelineInput = {
  name: string;
  stages: PipelineStageInput[];
};

export type PositionListItem = {
  id: string;
  title: string;
  slug: string;
  department: string | null;
  positionType: string | null;
  locations: PositionLocation[];
  remoteFlag: boolean;
  status: PositionStatus;
  publishMode: PublishMode;
  candidateCount: number;
  createdAt: string;
};

export type Position = PositionListItem & {
  educationLevel: string | null;
  educationLevelRequired: boolean;
  experienceLevel: string | null;
  salaryFrom: number | null;
  salaryTo: number | null;
  salaryPeriod: SalaryPeriod | null;
  salaryCurrency: string | null;
  description: string | null;
  applicationFormConfig: ApplicationFormConfig;
  applicationQuestionnaireId: string | null;
  assignedPipelineId: string | null;
  emailSenderName: string | null;
  hiringTeam: string[];
  stages: PipelineStage[];
};

export type PositionInput = {
  title: string;
  department?: string | null;
  locations?: PositionLocation[];
  remoteFlag?: boolean;
  positionType?: string | null;
  educationLevel?: string | null;
  educationLevelRequired?: boolean;
  experienceLevel?: string | null;
  salaryFrom?: number | null;
  salaryTo?: number | null;
  salaryPeriod?: SalaryPeriod | null;
  salaryCurrency?: string | null;
  description?: string | null;
  publishMode?: PublishMode;
  applicationFormConfig?: ApplicationFormConfig;
  applicationQuestionnaireId?: string | null;
  assignedPipelineId?: string | null;
  emailSenderName?: string | null;
  hiringTeam?: string[];

  status?: Extract<PositionStatus, "draft" | "open">;
};

export type PositionStatusUpdate = {
  status: PositionStatus;
};

export type QuestionnaireState = "none" | "pending" | "complete";

export type Candidate = {
  id: string;
  firstName: string;
  lastName: string | null;
  email: string;

  headline: string | null;

  stageId: string | null;
  starred: boolean;
  seen: boolean;
  archived: boolean;
  questionnaire: QuestionnaireState;
  appliedAt: string;

  /** When they entered their current stage: drives "12m in stage". */
  stageEnteredAt: string;
  /** Last change of any kind to the application: drives the last-activity filter. */
  lastActivityAt: string;
};

/** One row of the "who is this email to?" picker. */
export type CandidateSearchResult = {
  applicationId: string;
  firstName: string;
  lastName: string | null;
  email: string;
  positionTitle: string | null;
  archived: boolean;
};

export type CandidateUpdate = {
  starred?: boolean;
  seen?: boolean;
  stageId?: string | null;
  status?: "active" | "archived";
};

export type BulkCandidatePatch = {
  stageId?: string;
  status?: "active" | "archived";
};

export type BulkCandidateUpdate = {
  applicationIds: string[];
  patch: BulkCandidatePatch;
};

export type BulkCandidateFailure = {
  applicationId: string;
  reason: string;
};

export type BulkCandidateUpdateResult = {
  updated: Candidate[];
  failures: BulkCandidateFailure[];
};

export type BulkCandidateEmail = {
  applicationIds: string[];
  messageTemplateId: string;
};

export type BulkCandidateSendResult = {
  sent: string[];
  failures: BulkCandidateFailure[];
  /**
   * Stored to go out later rather than now (bulk email only): held for the
   * undo window, or past the mail relay's daily limit until it resets.
   */
  scheduled?: string[];
  /** The stored messages, for "Undo all". */
  scheduledMessageIds?: string[];
  /** When the held emails go out. */
  scheduledFor?: string;
  /** "undo": the undo window; "limit": the relay's daily limit. */
  scheduledReason?: "undo" | "limit";
};

export type BulkCandidateEmailResult = BulkCandidateSendResult;

export type BulkCandidateQuestionnaire = {
  applicationIds: string[];
  questionnaireTemplateId: string;
  sendReminders: boolean;
};

export type BulkCandidateQuestionnaireResult = BulkCandidateSendResult;

export type CandidateExportRecord = {
  applicationId: string;
  firstName: string;
  lastName: string | null;
  email: string;
  phone: string | null;
  headline: string | null;
  positionTitle: string;
  stageName: string | null;
  archived: boolean;
  starred: boolean;
  seen: boolean;
  questionnaire: QuestionnaireState;
  appliedAt: string;
  lastActivityAt: string;
  formAnswers: Record<string, string>;
};

export type PersonLink = { label: string; url: string };

export type ProfileApplicationSummary = {
  applicationId: string;
  positionId: string;
  positionTitle: string;
  stageName: string | null;
  archived: boolean;
};

export type ProfileDocument = {
  id: string;
  kind: "resume" | "video" | "other";
  filename: string | null;
  mimeType: string | null;

  url: string | null;
  createdAt: string;
};

export type AnswerMedia = {
  source: "upload" | "link";

  url: string | null;

  embedUrl: string | null;

  provider: string | null;
  filename: string | null;
  mimeType: string | null;
};

export type AnswerDetail = {
  questionId: string;
  type: QuestionType;
  prompt: string;

  value: string | number | string[] | null;

  media: AnswerMedia | null;
};

export type QuestionnaireResponseDetail = {
  id: string;
  name: string;
  context: "application_embedded" | "stage_sent" | "manual_sent";
  status: "pending" | "completed";
  sentAt: string | null;
  completedAt: string | null;
  remindersStoppedAt: string | null;
  /** Reminders still queued to chase this questionnaire, however it was sent. */
  pendingReminders: number;
  linkExpiresAt: string | null;
  /** How many questions the questionnaire has, answered or not. */
  questionCount: number;
  answers: AnswerDetail[];
};

/** What sending a questionnaire on the profile again did. */
export type QuestionnaireResendResult = {
  /** "resent": the same pending questionnaire with a fresh link. "asked_again": a new one after a completed one. */
  mode: "resent" | "asked_again";
  questionnaireResponseId: string;
};

export type CandidateProfile = {
  application: {
    id: string;
    positionId: string;
    positionTitle: string;
    stageId: string | null;
    starred: boolean;
    seen: boolean;
    archived: boolean;
    appliedAt: string;

    formAnswers: Record<string, string>;
    resubmissionAttempts: {
      count: number;
      mostRecentAt: string | null;
    };
  };
  person: {
    id: string;
    firstName: string;
    lastName: string | null;
    email: string;
    phone: string | null;
    headline: string | null;
    links: PersonLink[];
    customAttributes: Record<string, string>;
  };

  stages: PipelineStage[];

  applications: ProfileApplicationSummary[];
  documents: ProfileDocument[];
  questionnaires: QuestionnaireResponseDetail[];
  /** Automations still waiting for this application, soonest first. */
  upcomingAutomations: UpcomingAutomation[];
};

export type PersonUpdate = {
  phone?: string | null;
  headline?: string | null;
  links?: PersonLink[];
  customAttributes?: Record<string, string>;
};

export type Note = {
  id: string;
  body: string;
  authorName: string | null;
  createdAt: string;
};

export type NoteInput = {
  body: string;
};

export type QuestionType =
  | "short_text"
  | "long_text"
  | "single_choice"
  | "multi_choice"
  | "dropdown"
  | "numeric"
  | "video"
  | "file"
  | "date"
  | "yes_no";

export type QuestionOption = { value: string; label: string };

export type AnswerRoutingRule = {
  optionValue: string;
  pipelineTemplateStageId: string;
};

export type Question = {
  id: string;
  sortOrder: number;
  type: QuestionType;
  prompt: string;
  helpText: string | null;
  required: boolean;

  options: QuestionOption[];

  videoMaxDuration: number | null;
  videoAllowRetakes: boolean | null;

  numericMin: number | null;
  numericMax: number | null;

  answerRouting: AnswerRoutingRule[];
};

export type QuestionInput = {
  /** Set when editing a saved question, so it is updated rather than replaced. */
  id?: string;
  type: QuestionType;
  prompt: string;
  helpText?: string | null;
  required?: boolean;

  options?: QuestionOption[];

  videoMaxDuration?: number | null;
  videoAllowRetakes?: boolean | null;

  numericMin?: number | null;
  numericMax?: number | null;

  answerRouting?: AnswerRoutingRule[];
};

export type QuestionnaireTemplate = {
  id: string;
  name: string;

  questionCount: number;
  createdAt: string;
  updatedAt: string;
  questions: Question[];

  onCompletionTemplateStageId: string | null;

  /** The invite that carries the link: the Settings default or this questionnaire's own. */
  inviteEmail: QuestionnaireEmailChoice;
  /** The reminder that chases it, chosen the same way. */
  reminderEmail: QuestionnaireEmailChoice;
};

export type QuestionnaireInput = {
  name: string;
  questions: QuestionInput[];
  onCompletionTemplateStageId?: string | null;
  inviteEmail?: QuestionnaireEmailChoice;
  reminderEmail?: QuestionnaireEmailChoice;
};

export type QuestionnaireEmailChoice = {
  mode: "default" | "custom";
  subject: string | null;
  body: string | null;
};

export type QuestionnaireEmailText = {
  subject: string;
  body: string;
};

/** The default questionnaire emails, set in Settings. */
export type QuestionnaireEmailSettings = {
  invite: QuestionnaireEmailText;
  reminder: QuestionnaireEmailText;
};

export type MessageTemplate = {
  id: string;
  name: string;
  subject: string;
  body: string;
  createdAt: string;
  updatedAt: string;
};

export type MessageTemplateInput = {
  name: string;
  subject: string;
  body: string;
};

export type MessageDirection = "inbound" | "outbound";

export type MessageStatus = "scheduled" | "sending" | "cancelled" | "sent" | "failed" | "received";

export type MessageAttachment = {
  path: string;
  filename: string;
  mimeType: string | null;
  size: number;
};

export type Message = {
  id: string;
  personId: string;
  applicationId: string | null;
  direction: MessageDirection;
  fromAddress: string | null;
  toAddress: string | null;
  cc: string[];
  bcc: string[];
  subject: string | null;
  body: string | null;
  attachments: MessageAttachment[];
  senderName: string | null;
  status: MessageStatus | null;
  threadId: string | null;
  relayMessageId: string | null;
  rfcMessageId: string | null;
  inboundEmailId: string | null;
  headers: Record<string, string>;
  scheduledFor: string | null;
  sentAt: string | null;
  failureReason: string | null;
  createdAt: string;
};

export type SendMessageInput = {
  applicationId?: string | null;
  personId?: string | null;
  threadId?: string | null;
  subject: string;
  body: string;
  cc?: string[];
  bcc?: string[];
  scheduledFor?: string | null;
  templateId?: string | null;
};

export type MessageThread = {
  id: string;
  personId: string;
  positionId: string | null;
  applicationId: string | null;
  subject: string | null;
  lastMessageAt: string;
  lastInboundAt: string | null;
  readAt: string | null;
  unread: boolean;
  personName: string;
  personFirstName: string;
  personEmail: string;
  personPhone: string | null;
  personHeadline: string | null;
  positionTitle: string | null;
  stageName: string | null;
  preview: string;
  createdAt: string;
};

export type MessageThreadDetail = MessageThread & {
  messages: Message[];
};

export type UnmatchedInboundReason = "no_matching_person" | "sender_unreadable";

export type UnmatchedInboundEmail = {
  id: string;
  fromAddress: string;
  fromName: string;
  subject: string | null;
  bodyText: string;
  preview: string;
  reason: UnmatchedInboundReason;
  attachmentCount: number;
  receivedAt: string;
};

export type ComposeRecipient = {
  personId: string;
  applicationId: string | null;
  firstName: string;
  lastName: string | null;
  email: string;
  positionTitle: string | null;
  customAttributes: Record<string, string>;
};

export type StageActionType = "send_email" | "send_questionnaire" | "move_to_stage";

export type ReminderConfig = {
  enabled: boolean;

  intervalMinutes: number[];
  maxCount: number;
  messageTemplateId: string | null;
};

export type StageAction = {
  id: string;
  positionStageId: string;
  type: StageActionType;
  enabled: boolean;
  delayMinutes: number;
  sortOrder: number;
  messageTemplateId: string | null;
  questionnaireTemplateId: string | null;
  targetPositionStageId: string | null;
  reminderConfig: ReminderConfig | null;
  createdAt: string;
};

export type StageActionInput = {
  positionStageId: string;
  type: StageActionType;
  enabled: boolean;
  delayMinutes: number;
  sortOrder: number;
  messageTemplateId: string | null;
  questionnaireTemplateId: string | null;
  targetPositionStageId: string | null;
  reminderConfig: ReminderConfig | null;
};

export type StageActionUpdate = {
  enabled?: boolean;
  delayMinutes?: number;
  sortOrder?: number;
  messageTemplateId?: string;
  questionnaireTemplateId?: string;
  targetPositionStageId?: string;
  reminderConfig?: ReminderConfig | null;
};

export type ScheduledActionKind = "stage_action" | "reminder" | "answer_routing";

export type ScheduledActionStatus =
  | "pending"
  | "claimed"
  | "sent"
  | "failed"
  | "skipped"
  | "cancelled";

export type ScheduledActionRunSummary = {
  claimed: number;
  sent: number;
  skipped: number;
  failed: number;
  /** Put back in the queue until the mail relay's daily limit resets. */
  deferred: number;
};

export type ScheduledMessageRunSummary = {
  claimed: number;
  sent: number;
  failed: number;
  /** Rescheduled for after the mail relay's daily limit resets. */
  deferred: number;
};

export type WorkerRunSummary = {
  actions: ScheduledActionRunSummary;
  messages: ScheduledMessageRunSummary;
};

export type HostedQuestionnaireState = "unknown" | "expired" | "completed" | "open";

export type HostedQuestionnaire = {
  name: string;
  positionTitle: string;
  positionId: string;
  expiresAt: string;
  questions: Question[];
};

export type HostedQuestionnaireSubmissionResult = {
  completed: boolean;
};

export type ReportTotals = {
  applicationsReceived: number;
  archived: number;
};

export type ReportWeek = {
  weekNumber: number;
  applicationsReceived: number;
};

export type ReportPositionStage = {
  stageId: string | null;
  name: string;
  applications: number;
};

export type ReportPosition = {
  positionId: string;
  title: string;
  applicationsReceived: number;
  stages: ReportPositionStage[];
};

export type MonthlyReport = {
  month: string;
  availableMonths: string[];
  totals: ReportTotals;
  weeks: ReportWeek[];
  positions: ReportPosition[];
};

export type SlackSettings = {
  channelId: string | null;
  channelName: string | null;
  enabled: boolean;
  tokenConfigured: boolean;
  tokenSetAt: string | null;
};

export type Department = {
  id: string;
  name: string;
};

export type TeamMember = {
  id: string;
  fullName: string | null;
  email: string;
  createdAt: string;
};

/** The two safety windows (migration 0054), set in Settings. */
export type EmailTimingSettings = {
  /** Every automated email and questionnaire waits at least this long. */
  automationSafetyDelayMinutes: number;
  /** An email a person sends is held this long, with Undo and Send now. */
  sendUndoMinutes: number;
};

/** A queued automation for one candidate, shown with Cancel and Send now. */
export type UpcomingAutomation = {
  id: string;
  kind: "stage_action" | "reminder";
  /** What it does: "Send email", "Send questionnaire", "Move to stage", "Reminder". */
  action: string;
  /** Template, questionnaire or target stage name, when known. */
  subject: string | null;
  stageName: string | null;
  scheduledFor: string;
};

export type EmailSettings = {
  relayAddress: string;
  companyName: string;
  careersUrl: string;
};
