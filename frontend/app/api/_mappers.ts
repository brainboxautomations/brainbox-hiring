import type {
  AnswerDetail,
  AnswerMedia,
  AnswerRoutingRule,
  ApplicationFormConfig,
  Candidate,
  CandidateExportRecord,
  FieldSetting,
  Message,
  MessageAttachment,
  MessageStatus,
  MessageTemplate,
  MessageThread,
  MessageThreadDetail,
  Note,
  PersonLink,
  Pipeline,
  PipelineStage,
  Position,
  PositionListItem,
  PositionLocation,
  ProfileDocument,
  Question,
  QuestionOption,
  QuestionType,
  QuestionnaireResponseDetail,
  QuestionnaireState,
  QuestionnaireEmailChoice,
  QuestionnaireTemplate,
  ReminderConfig,
  ReportPosition,
  ReportPositionStage,
  ReportTotals,
  ReportWeek,
  SlackSettings,
  StageAction,
  StageActionType,
  TeamMember,
  UpcomingAutomation,
  UnmatchedInboundEmail,
  UnmatchedInboundReason,
} from "@/types/api";
import type { Json } from "@/types/database.types";
import {
  extractAddress,
  extractDisplayName,
  htmlToPlainText,
  messagePreview,
} from "@/utilities/email-headers";

type StageRow = {
  id: string;
  name: string;
  sort_order: number;
};

export function mapPipelineStage(row: StageRow): PipelineStage {
  return {
    id: row.id,
    name: row.name,
    sortOrder: row.sort_order,
  };
}

export function mapPipeline(
  row: {
    id: string;
    name: string;
    is_template: boolean;
    created_at: string;
    pipeline_template_stages?: StageRow[] | null;
  },
  usageCount: number,
): Pipeline {
  const stages = (row.pipeline_template_stages ?? [])
    .slice()
    .sort((a, b) => a.sort_order - b.sort_order)
    .map(mapPipelineStage);

  return {
    id: row.id,
    name: row.name,
    isTemplate: row.is_template,
    usageCount,
    createdAt: row.created_at,
    stages,
  };
}

function normalizeLocations(raw: Json): PositionLocation[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item): PositionLocation | null => {
      if (!item || typeof item !== "object" || Array.isArray(item)) return null;
      const { country, detail } = item;
      if (typeof country !== "string") return null;
      return typeof detail === "string" ? { country, detail } : { country };
    })
    .filter((x): x is PositionLocation => x !== null);
}

function normalizeHiringTeam(raw: Json): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((item): item is string => typeof item === "string");
}

function isFieldSetting(value: Json | undefined): value is FieldSetting {
  return value === "required" || value === "optional" || value === "disabled";
}

function normalizeFormConfig(raw: Json): ApplicationFormConfig {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const config: ApplicationFormConfig = {};
  for (const [field, setting] of Object.entries(raw)) {
    if (isFieldSetting(setting)) config[field] = setting;
  }
  return config;
}

type PositionRow = {
  id: string;
  title: string;
  slug: string;
  department: string | null;
  position_type: string | null;
  locations: Json;
  remote_flag: boolean;
  status: PositionListItem["status"];
  publish_mode: PositionListItem["publishMode"];
  created_at: string;
};

export function mapPositionListItem(row: PositionRow, candidateCount: number): PositionListItem {
  return {
    id: row.id,
    title: row.title,
    slug: row.slug,
    department: row.department,
    positionType: row.position_type,
    locations: normalizeLocations(row.locations),
    remoteFlag: row.remote_flag,
    status: row.status,
    publishMode: row.publish_mode,
    candidateCount,
    createdAt: row.created_at,
  };
}

type PositionDetailRow = PositionRow & {
  education_level: string | null;
  education_level_required: boolean;
  experience_level: string | null;
  salary_from: number | null;
  salary_to: number | null;
  salary_period: Position["salaryPeriod"];
  salary_currency: string | null;
  description: string | null;
  application_form_config: Json;
  application_questionnaire_id: string | null;
  assigned_pipeline_id: string | null;
  email_sender_name: string | null;
  hiring_team: Json;
  position_stages?: StageRow[] | null;
};

function normalizeOptions(raw: Json): QuestionOption[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item): QuestionOption | null => {
      if (!item || typeof item !== "object" || Array.isArray(item)) return null;
      const { value, label } = item;
      return typeof value === "string" && typeof label === "string" ? { value, label } : null;
    })
    .filter((x): x is QuestionOption => x !== null);
}

export function normalizeAnswerRouting(raw: Json): AnswerRoutingRule[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item): AnswerRoutingRule | null => {
      if (!item || typeof item !== "object" || Array.isArray(item)) return null;
      const optionValue = item.option_value;
      const pipelineTemplateStageId = item.pipeline_template_stage_id;
      if (typeof optionValue !== "string" || typeof pipelineTemplateStageId !== "string") {
        return null;
      }
      return { optionValue, pipelineTemplateStageId };
    })
    .filter((rule): rule is AnswerRoutingRule => rule !== null);
}

export function toAnswerRoutingRows(rules: AnswerRoutingRule[]): Json {
  return rules.map((rule) => ({
    option_value: rule.optionValue,
    pipeline_template_stage_id: rule.pipelineTemplateStageId,
  }));
}

export function normalizeReminderConfig(raw: Json): ReminderConfig | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;

  const { enabled, interval_minutes, max_count, message_template_id } = raw;
  if (typeof enabled !== "boolean") return null;
  if (typeof max_count !== "number") return null;
  if (!Array.isArray(interval_minutes)) return null;

  return {
    enabled,
    intervalMinutes: interval_minutes.filter((value): value is number => typeof value === "number"),
    maxCount: max_count,
    messageTemplateId: typeof message_template_id === "string" ? message_template_id : null,
  };
}

export function toReminderConfigRow(config: ReminderConfig | null): Json {
  if (!config) return null;
  return {
    enabled: config.enabled,
    interval_minutes: config.intervalMinutes,
    max_count: config.maxCount,
    message_template_id: config.messageTemplateId,
  };
}

type QuestionRow = {
  id: string;
  sort_order: number;
  type: QuestionType;
  prompt: string;
  help_text: string | null;
  required: boolean;
  options: Json;
  video_max_duration: number | null;
  video_allow_retakes?: boolean | null;
  numeric_min?: number | null;
  numeric_max?: number | null;
  answer_routing?: Json;
};

export function mapQuestion(row: QuestionRow): Question {
  return {
    id: row.id,
    sortOrder: row.sort_order,
    type: row.type,
    prompt: row.prompt,
    helpText: row.help_text,
    required: row.required,
    options: normalizeOptions(row.options),
    videoMaxDuration: row.video_max_duration,
    videoAllowRetakes: row.video_allow_retakes ?? null,
    numericMin: row.numeric_min ?? null,
    numericMax: row.numeric_max ?? null,
    answerRouting: normalizeAnswerRouting(row.answer_routing ?? []),
  };
}

type QuestionnaireTemplateRow = {
  id: string;
  name: string;
  created_at: string;
  updated_at: string;
  on_completion_template_stage_id?: string | null;
  invite_email_mode?: string | null;
  invite_subject?: string | null;
  invite_body?: string | null;
  reminder_email_mode?: string | null;
  reminder_subject?: string | null;
  reminder_body?: string | null;
  questions?: QuestionRow[] | null;
};

function mapQuestionnaireEmailChoice(
  mode: string | null | undefined,
  subject: string | null | undefined,
  body: string | null | undefined,
): QuestionnaireEmailChoice {
  return {
    mode: mode === "custom" ? "custom" : "default",
    subject: subject ?? null,
    body: body ?? null,
  };
}

export function mapQuestionnaireTemplate(row: QuestionnaireTemplateRow): QuestionnaireTemplate {
  const questions = (row.questions ?? [])
    .slice()
    .sort((a, b) => a.sort_order - b.sort_order)
    .map(mapQuestion);

  return {
    id: row.id,
    name: row.name,
    questionCount: questions.length,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    questions,
    onCompletionTemplateStageId: row.on_completion_template_stage_id ?? null,
    inviteEmail: mapQuestionnaireEmailChoice(
      row.invite_email_mode,
      row.invite_subject,
      row.invite_body,
    ),
    reminderEmail: mapQuestionnaireEmailChoice(
      row.reminder_email_mode,
      row.reminder_subject,
      row.reminder_body,
    ),
  };
}

type CandidateRow = {
  id: string;
  current_stage_id: string | null;
  starred: boolean;
  seen: boolean;
  status: "active" | "archived";
  applied_at: string;
  updated_at: string;
  stage_entered_at: string;

  people: {
    first_name: string;
    last_name: string | null;
    email: string;
    headline?: string | null;
  } | null;
  questionnaire_responses: { status: "pending" | "completed" }[] | null;
};

function questionnaireStateOf(
  responses: { status: "pending" | "completed" }[] | null,
): QuestionnaireState {
  const rows = responses ?? [];
  if (rows.some((response) => response.status === "completed")) return "complete";
  if (rows.some((response) => response.status === "pending")) return "pending";
  return "none";
}

export function mapCandidate(row: CandidateRow): Candidate {
  const questionnaire = questionnaireStateOf(row.questionnaire_responses);

  const person = row.people;
  return {
    id: row.id,
    firstName: person?.first_name ?? "Unknown",
    lastName: person?.last_name ?? null,
    email: person?.email ?? "",
    headline: person?.headline ?? null,
    stageId: row.current_stage_id,
    starred: row.starred,
    seen: row.seen,
    archived: row.status === "archived",
    questionnaire,
    appliedAt: row.applied_at,
    // Set only by a real stage change (migration 0046). `updated_at` moves on
    // any write, so reading it here reset a card's clock whenever someone
    // opened or starred the candidate.
    stageEnteredAt: row.stage_entered_at,
    lastActivityAt: row.updated_at,
  };
}

type CandidateExportRow = {
  id: string;
  status: "active" | "archived";
  starred: boolean;
  seen: boolean;
  applied_at: string;
  updated_at: string;
  application_form_answers: Json;

  people: {
    first_name: string;
    last_name: string | null;
    email: string;
    phone: string | null;
    headline: string | null;
  } | null;
  positions: { title: string } | null;
  position_stages: { name: string } | null;
  questionnaire_responses: { status: "pending" | "completed" }[] | null;
};

export function mapCandidateExportRecord(row: CandidateExportRow): CandidateExportRecord {
  const person = row.people;
  return {
    applicationId: row.id,
    firstName: person?.first_name ?? "Unknown",
    lastName: person?.last_name ?? null,
    email: person?.email ?? "",
    phone: person?.phone ?? null,
    headline: person?.headline ?? null,
    positionTitle: row.positions?.title ?? "Untitled position",
    stageName: row.position_stages?.name ?? null,
    archived: row.status === "archived",
    starred: row.starred,
    seen: row.seen,
    questionnaire: questionnaireStateOf(row.questionnaire_responses),
    appliedAt: row.applied_at,
    lastActivityAt: row.updated_at,
    formAnswers: normalizeStringMap(row.application_form_answers),
  };
}

type NoteRow = {
  id: string;
  body: string;
  created_at: string;

  profiles: { full_name: string | null } | null;
};

export function mapNote(row: NoteRow): Note {
  return {
    id: row.id,
    body: row.body,
    authorName: row.profiles?.full_name ?? null,
    createdAt: row.created_at,
  };
}

type DocumentRow = {
  id: string;
  kind: ProfileDocument["kind"];
  filename: string | null;
  mime_type: string | null;
  created_at: string;
};

export function mapDocument(row: DocumentRow, url: string | null): ProfileDocument {
  return {
    id: row.id,
    kind: row.kind,
    filename: row.filename,
    mimeType: row.mime_type,
    url,
    createdAt: row.created_at,
  };
}

type AnswerRow = {
  question_id: string;
  value: unknown;
  questions: {
    type: QuestionType;
    prompt: string;
  } | null;
};

export function mapAnswer(row: AnswerRow, media: AnswerMedia | null): AnswerDetail {
  const type = row.questions?.type ?? "short_text";
  const isFile = type === "file" || type === "video";
  const value = isFile ? null : ((row.value as AnswerDetail["value"]) ?? null);
  return {
    questionId: row.question_id,
    type,
    prompt: row.questions?.prompt ?? "",
    value,
    media,
  };
}

type ResponseRow = {
  id: string;
  context: QuestionnaireResponseDetail["context"];
  status: QuestionnaireResponseDetail["status"];
  sent_at: string | null;
  completed_at: string | null;
  reminders_stopped_at: string | null;
  access_token_expires_at: string | null;
  questionnaire_templates: { name: string; questions: { count: number }[] } | null;
  scheduled_actions: { kind: string; status: string }[];
};

export function mapResponse(
  row: ResponseRow,
  answers: AnswerDetail[],
): QuestionnaireResponseDetail {
  return {
    id: row.id,
    name: row.questionnaire_templates?.name ?? "Questionnaire",
    context: row.context,
    status: row.status,
    sentAt: row.sent_at,
    completedAt: row.completed_at,
    remindersStoppedAt: row.reminders_stopped_at,
    pendingReminders: row.scheduled_actions.filter(
      (action) => action.kind === "reminder" && action.status === "pending",
    ).length,
    linkExpiresAt: row.access_token_expires_at,
    questionCount: row.questionnaire_templates?.questions[0]?.count ?? answers.length,
    answers,
  };
}

export function normalizeStringMap(raw: Json): Record<string, string> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const map: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (typeof value === "string") map[key] = value;
  }
  return map;
}

export function normalizeLinks(raw: unknown): PersonLink[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item): PersonLink | null => {
      if (typeof item === "string") return { label: item, url: item };
      if (item && typeof item === "object") {
        const url = (item as Record<string, unknown>).url;
        const label = (item as Record<string, unknown>).label;
        if (typeof url === "string") {
          return { label: typeof label === "string" && label ? label : url, url };
        }
      }
      return null;
    })
    .filter((x): x is PersonLink => x !== null);
}

type MessageTemplateRow = {
  id: string;
  name: string;
  subject: string | null;
  body: string | null;
  created_at: string;
  updated_at: string;
};

export function mapMessageTemplate(row: MessageTemplateRow): MessageTemplate {
  return {
    id: row.id,
    name: row.name,
    subject: row.subject ?? "",
    body: row.body ?? "",
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function normalizeAddressList(raw: Json): string[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

export function normalizeAttachments(raw: Json): MessageAttachment[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item): MessageAttachment | null => {
      if (!item || typeof item !== "object" || Array.isArray(item)) return null;
      const { path, filename, mimeType, size } = item as Record<string, unknown>;
      if (typeof path !== "string" || path.length === 0) return null;
      return {
        path,
        filename: typeof filename === "string" && filename ? filename : "attachment",
        mimeType: typeof mimeType === "string" && mimeType ? mimeType : null,
        size: typeof size === "number" && Number.isFinite(size) && size >= 0 ? size : 0,
      };
    })
    .filter((x): x is MessageAttachment => x !== null);
}

const MESSAGE_STATUSES: MessageStatus[] = [
  "scheduled",
  "sending",
  "cancelled",
  "sent",
  "failed",
  "received",
];

function normalizeMessageStatus(raw: string | null): MessageStatus | null {
  return MESSAGE_STATUSES.find((status) => status === raw) ?? null;
}

type MessageRow = {
  id: string;
  person_id: string;
  application_id: string | null;
  direction: Message["direction"];
  from_address: string | null;
  to_address: string | null;
  cc: Json;
  bcc: Json;
  subject: string | null;
  body: string | null;
  attachments: Json;
  status: string | null;
  thread_id: string | null;
  relay_message_id: string | null;
  rfc_message_id: string | null;
  inbound_email_id: string | null;
  headers: Json;
  scheduled_for: string | null;
  sent_at: string | null;
  failure_reason: string | null;
  created_at: string;

  profiles?: { full_name: string | null } | null;
};

export function mapMessage(row: MessageRow): Message {
  return {
    id: row.id,
    personId: row.person_id,
    applicationId: row.application_id,
    direction: row.direction,
    fromAddress: row.from_address,
    toAddress: row.to_address,
    cc: normalizeAddressList(row.cc),
    bcc: normalizeAddressList(row.bcc),
    subject: row.subject,
    body: row.body,
    attachments: normalizeAttachments(row.attachments),
    senderName: row.profiles?.full_name ?? null,
    status: normalizeMessageStatus(row.status),
    threadId: row.thread_id,
    relayMessageId: row.relay_message_id,
    rfcMessageId: row.rfc_message_id,
    inboundEmailId: row.inbound_email_id,
    headers: normalizeStringMap(row.headers),
    scheduledFor: row.scheduled_for,
    sentAt: row.sent_at,
    failureReason: row.failure_reason,
    createdAt: row.created_at,
  };
}

export function mapPosition(row: PositionDetailRow, candidateCount: number): Position {
  const stages = (row.position_stages ?? [])
    .slice()
    .sort((a, b) => a.sort_order - b.sort_order)
    .map(mapPipelineStage);

  return {
    ...mapPositionListItem(row, candidateCount),
    educationLevel: row.education_level,
    educationLevelRequired: row.education_level_required,
    experienceLevel: row.experience_level,
    salaryFrom: row.salary_from,
    salaryTo: row.salary_to,
    salaryPeriod: row.salary_period,
    salaryCurrency: row.salary_currency,
    description: row.description,
    applicationFormConfig: normalizeFormConfig(row.application_form_config),
    applicationQuestionnaireId: row.application_questionnaire_id,
    assignedPipelineId: row.assigned_pipeline_id,
    emailSenderName: row.email_sender_name,
    hiringTeam: normalizeHiringTeam(row.hiring_team),
    stages,
  };
}

function firstOf<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

type ThreadPersonRow = {
  id: string;
  first_name: string;
  last_name: string | null;
  email: string;
  phone: string | null;
  headline: string | null;
};

type ThreadPositionRow = { id: string; title: string };

type ThreadStageRow = { name: string };

type ThreadApplicationRow = {
  id: string;
  position_stages: ThreadStageRow | ThreadStageRow[] | null;
};

type ThreadPreviewMessageRow = {
  body: string | null;
  direction: Message["direction"];
  created_at: string;
};

export type MessageThreadRow = {
  id: string;
  person_id: string;
  position_id: string | null;
  application_id: string | null;
  subject: string | null;
  last_message_at: string;
  last_inbound_at: string | null;
  read_at: string | null;
  created_at: string;

  people?: ThreadPersonRow | ThreadPersonRow[] | null;
  positions?: ThreadPositionRow | ThreadPositionRow[] | null;
  applications?: ThreadApplicationRow | ThreadApplicationRow[] | null;
  messages?: ThreadPreviewMessageRow[] | null;
};

export function bodyToPlainText(direction: Message["direction"], body: string | null): string {
  if (!body) return "";
  return direction === "outbound" ? htmlToPlainText(body) : body;
}

function threadIsUnread(row: MessageThreadRow): boolean {
  if (!row.last_inbound_at) return false;
  if (!row.read_at) return true;
  return new Date(row.read_at).getTime() < new Date(row.last_inbound_at).getTime();
}

export function mapMessageThread(row: MessageThreadRow): MessageThread {
  const person = firstOf(row.people);
  const position = firstOf(row.positions);
  const application = firstOf(row.applications);
  const stage = firstOf(application?.position_stages);
  const latest = (row.messages ?? [])
    .slice()
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())[0];

  const fullName = `${person?.first_name ?? ""} ${person?.last_name ?? ""}`.trim();

  return {
    id: row.id,
    personId: row.person_id,
    positionId: row.position_id,
    applicationId: row.application_id,
    subject: row.subject,
    lastMessageAt: row.last_message_at,
    lastInboundAt: row.last_inbound_at,
    readAt: row.read_at,
    unread: threadIsUnread(row),
    personName: fullName || (person?.email ?? "Unknown"),
    personFirstName: person?.first_name ?? "",
    personEmail: person?.email ?? "",
    personPhone: person?.phone ?? null,
    personHeadline: person?.headline ?? null,
    positionTitle: position?.title ?? null,
    stageName: stage?.name ?? null,
    preview: latest ? messagePreview(bodyToPlainText(latest.direction, latest.body)) : "",
    createdAt: row.created_at,
  };
}

export function mapMessageThreadDetail(
  row: MessageThreadRow,
  messages: Message[],
): MessageThreadDetail {
  const last = messages[messages.length - 1];
  return {
    ...mapMessageThread(row),
    preview: last ? messagePreview(bodyToPlainText(last.direction, last.body)) : "",
    messages,
  };
}

const UNMATCHED_REASONS: UnmatchedInboundReason[] = ["no_matching_person", "sender_unreadable"];

export type UnmatchedInboundRow = {
  id: string;
  from_address: string;
  subject: string | null;
  body_text: string | null;
  body_html: string | null;
  attachments: Json;
  reason: string;
  received_at: string;
};

export function mapUnmatchedInboundEmail(row: UnmatchedInboundRow): UnmatchedInboundEmail {
  const bodyText = row.body_text ?? htmlToPlainText(row.body_html);
  const attachments = Array.isArray(row.attachments) ? row.attachments.length : 0;

  return {
    id: row.id,
    fromAddress: extractAddress(row.from_address) ?? row.from_address,
    fromName: extractDisplayName(row.from_address),
    subject: row.subject,
    bodyText,
    preview: messagePreview(bodyText),
    reason: UNMATCHED_REASONS.find((reason) => reason === row.reason) ?? "no_matching_person",
    attachmentCount: attachments,
    receivedAt: row.received_at,
  };
}

type StageActionRow = {
  id: string;
  position_stage_id: string;
  type: StageActionType;
  enabled: boolean;
  delay_minutes: number;
  sort_order: number;
  message_template_id: string | null;
  questionnaire_template_id: string | null;
  target_position_stage_id: string | null;
  reminder_config?: Json;
  created_at: string;
};

export function mapStageAction(row: StageActionRow): StageAction {
  return {
    id: row.id,
    positionStageId: row.position_stage_id,
    type: row.type,
    enabled: row.enabled,
    delayMinutes: row.delay_minutes,
    sortOrder: row.sort_order,
    messageTemplateId: row.message_template_id,
    questionnaireTemplateId: row.questionnaire_template_id,
    targetPositionStageId: row.target_position_stage_id,
    reminderConfig: normalizeReminderConfig(row.reminder_config ?? null),
    createdAt: row.created_at,
  };
}

type ReportTotalsRow = {
  applications_received: number;
  archived: number;
};

export function mapReportTotals(row: ReportTotalsRow | null): ReportTotals {
  return {
    applicationsReceived: row?.applications_received ?? 0,
    archived: row?.archived ?? 0,
  };
}

type ReportWeekRow = {
  week_number: number;
  applications_received: number;
};

export function mapReportWeek(row: ReportWeekRow): ReportWeek {
  return {
    weekNumber: row.week_number,
    applicationsReceived: row.applications_received,
  };
}

type ReportPositionRow = {
  position_id: string;
  position_title: string;
  applications_received: number;
};

type ReportPositionStageRow = {
  position_id: string;
  stage_id: string | null;
  stage_name: string;
  applications: number;
};

export function mapReportPositions(
  positionRows: ReportPositionRow[],
  stageRows: ReportPositionStageRow[],
): ReportPosition[] {
  const stagesByPosition = new Map<string, ReportPositionStage[]>();
  for (const row of stageRows) {
    const stages = stagesByPosition.get(row.position_id) ?? [];
    stages.push({ stageId: row.stage_id, name: row.stage_name, applications: row.applications });
    stagesByPosition.set(row.position_id, stages);
  }

  return positionRows.map((row) => ({
    positionId: row.position_id,
    title: row.position_title,
    applicationsReceived: row.applications_received,
    stages: stagesByPosition.get(row.position_id) ?? [],
  }));
}

type SlackConfigRow = {
  channel_id: string | null;
  channel_name: string | null;
  enabled: boolean;
};

type SlackTokenStateRow = {
  configured: boolean;
  token_set_at: string | null;
};

export function mapSlackSettings(
  config: SlackConfigRow,
  tokenState: SlackTokenStateRow | null,
): SlackSettings {
  return {
    channelId: config.channel_id,
    channelName: config.channel_name,
    enabled: config.enabled,
    tokenConfigured: tokenState?.configured ?? false,
    tokenSetAt: tokenState?.token_set_at ?? null,
  };
}

type ProfileRow = {
  id: string;
  full_name: string | null;
  email: string;
  created_at: string;
};

export function mapTeamMember(row: ProfileRow): TeamMember {
  return {
    id: row.id,
    fullName: row.full_name,
    email: row.email,
    createdAt: row.created_at,
  };
}

type UpcomingAutomationRow = {
  id: string;
  kind: string;
  scheduled_for: string;
  reminder_number: number | null;
  origin_stage: { name: string } | { name: string }[] | null;
  stage_actions: {
    type: string;
    message_templates: { name: string } | null;
    questionnaire_templates: { name: string } | null;
    target_stage: { name: string } | null;
  } | null;
  questionnaire_responses: { questionnaire_templates: { name: string } | null } | null;
};

const ACTION_LABELS: Record<string, string> = {
  send_email: "Send email",
  send_questionnaire: "Send questionnaire",
  move_to_stage: "Move to stage",
};

export function mapUpcomingAutomation(row: UpcomingAutomationRow): UpcomingAutomation {
  const action = firstOf(row.stage_actions);
  const stageName = firstOf(row.origin_stage)?.name ?? null;

  if (row.kind === "reminder") {
    const response = firstOf(row.questionnaire_responses);
    return {
      id: row.id,
      kind: "reminder",
      action: row.reminder_number ? `Reminder ${row.reminder_number}` : "Reminder",
      subject: firstOf(response?.questionnaire_templates)?.name ?? null,
      stageName,
      scheduledFor: row.scheduled_for,
    };
  }

  const subject =
    firstOf(action?.message_templates)?.name ??
    firstOf(action?.questionnaire_templates)?.name ??
    firstOf(action?.target_stage)?.name ??
    null;

  return {
    id: row.id,
    kind: "stage_action",
    action: ACTION_LABELS[action?.type ?? ""] ?? "Automation",
    subject,
    stageName,
    scheduledFor: row.scheduled_for,
  };
}
