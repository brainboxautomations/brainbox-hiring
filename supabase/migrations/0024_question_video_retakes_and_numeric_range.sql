-- M5 — the last two questionnaire-builder fields that were silently discarded.
--
-- This is the remainder of codebase-audit-2026-08-04.md finding 1. M6b closed
-- the other half by persisting per-option answer routing and the on-completion
-- stage. What was left: the video question's "Allow retakes" switch and the
-- numeric question's Min / Max inputs. Both are real controls on
-- /questionnaires, both round-tripped only inside an editing session, and both
-- vanished on save. A control that lies is worse than an absent one, so they
-- get columns rather than being deleted — they are ordinary questionnaire
-- configuration and the hosted page (0025) reads them.
--
-- Columns follow the question type, the same rule 0019 and 0022 apply to the
-- automation payload columns: a numeric bound on a video question is not a
-- harmless stray value, it is a row nothing downstream knows how to read.

alter table questions
  -- Video only. Nullable rather than `not null default true`, so "this question
  -- has no opinion about retakes" is distinguishable from "retakes are allowed",
  -- and the constraint below can hold it to the video type.
  add column video_allow_retakes boolean,
  -- Numeric only. `numeric` rather than integer: the question type accepts any
  -- number, and a bound that cannot express 2.5 would silently round.
  add column numeric_min numeric,
  add column numeric_max numeric;

alter table questions
  add constraint questions_video_allow_retakes_type_check
  check (video_allow_retakes is null or type = 'video');

alter table questions
  add constraint questions_numeric_range_type_check
  check ((numeric_min is null and numeric_max is null) or type = 'numeric');

-- An inverted range would render a control no answer can satisfy. Equal bounds
-- are allowed — "the answer must be exactly 5" is a legitimate thing to ask.
alter table questions
  add constraint questions_numeric_range_order_check
  check (numeric_min is null or numeric_max is null or numeric_min <= numeric_max);
