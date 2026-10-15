-- Sprint 3 — candidate profile.
-- People gain an optional headline (e.g. "Senior Frontend Engineer, 6 yrs"),
-- shown on the board card subtitle and the profile header. There was no column
-- for it before; the Candidate DTO hardcoded null. Nullable and low-risk.
alter table people add column headline text;
