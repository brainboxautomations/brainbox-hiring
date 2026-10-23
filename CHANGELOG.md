# Changelog

All notable changes to openHR are recorded here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

When you upgrade, read every entry since your version: new migrations, new
environment variables and one-off steps are listed here. See
[docs/self-hosting.md](docs/self-hosting.md#upgrading).

## [Unreleased]

### Changed

- Renamed the project from BrainBox ATS to openHR.
- Relicensed from the PolyForm Shield License 1.0.0 to the MIT License. See
  [LICENSE](LICENSE).

## [1.0.0] - 2026-10-15

The first public release, source-available under the PolyForm Shield License
1.0.0.

### Added

- **Positions** with a five-step wizard, listed, unlisted or disabled on the
  public careers site, and a pipeline of stages that is frozen once the position
  goes live. Pipeline templates and departments.
- **Public careers pages** branded with the hiring company's name, website and
  logo (`COMPANY_*` variables), with a "Powered by BrainBox" link.
- **Apply form** with résumé upload, an optional application questionnaire, and
  video answers recorded in the browser or pasted as a link.
- **Board** per position: drag between stages, filters, star, and bulk move,
  archive, export, email and send questionnaire.
- **Candidate profile**: experience, résumé preview (PDF, Word .docx, images),
  documents, questionnaires, notes, custom attributes and the email thread.
- **Stage automation**: on a candidate's first entry to a stage, send an email,
  send a questionnaire (with reminders) or move them on, each after its own
  delay; leaving the stage first cancels what is pending. Run by a `pg_cron`
  worker.
- **Questionnaires**: ten question types, single-use emailed links, reminders
  until completed, and moving the candidate by answer or on completion.
- **Two-way email** through Resend: templates, merge variables, CC and BCC,
  attachments and scheduled send from one relay address, with replies arriving
  in a shared Inbox through a signature-verified webhook.
- **Slack** notification when a candidate replies.
- **Reports**, and **Settings** for team members, email and Slack.
- **Spam protection** on the public forms: database rate limits and an optional
  Cloudflare Turnstile captcha.
- **File storage** on Cloudflare R2 with short-lived signed links, and a nightly
  clean-up of abandoned uploads.
- **Tests**: unit, component, API integration and pgTAP database suites, the
  last two against a throwaway local Supabase stack, all run in CI.
- **Documentation** for self-hosting, development, deployment and promoting
  staging to production with `scripts/promote.sh`.
