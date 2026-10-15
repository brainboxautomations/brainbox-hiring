export const CANDIDATE_SELECT =
  "id, current_stage_id, starred, seen, status, applied_at, updated_at, stage_entered_at, people(first_name, last_name, email, headline), questionnaire_responses(status)";

export const CANDIDATE_EXPORT_SELECT =
  "id, status, starred, seen, applied_at, updated_at, application_form_answers, people(first_name, last_name, email, phone, headline), positions(title), position_stages(name), questionnaire_responses(status)";
