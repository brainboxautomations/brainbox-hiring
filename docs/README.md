# Docs

The root [`../README.md`](../README.md) says what BrainBox ATS is and how to get
started. These documents cover how to run, deploy and change it, and the
**why**: how the system is shaped and how it is tested.

## Current: keep these accurate

| Document                                             | What it gives you                                                                                                                                                                  |
| ---------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [development.md](development.md)                     | Running the app locally, every command, the git hooks, environment variables for development, schema changes and running the L3 / L4 suites, plus the ground rules for changes. |
| [architecture.md](architecture.md)                   | **Read before changing anything.** How the code is organised, the conventions, and "Design decisions worth knowing": the reasoning behind the non-obvious choices.               |
| [testing-strategy.md](testing-strategy.md)           | The automated test layers, what each one covers, and how to run them.                                                                                                              |
| [testing-checklist.md](testing-checklist.md)         | The manual QA plan: happy and failure paths for every requirement area, plus the known gaps not to report.                                                                         |
| [self-hosting.md](self-hosting.md)                   | Deploying your own copy, step by step: Supabase, migrations, Auth settings, storage, email, the automation worker, hosting, upgrading, and every environment variable.           |
| [deployment.md](deployment.md)                       | The AWS Amplify specifics (the two settings that must agree, environment variables, redeploying), the inbound-email webhook, and promoting staging to production with `promote.sh`. |

The schema itself is documented too: **comments in
[`../supabase/migrations/`](../supabase/migrations/) carry the reasoning** for the
identity rule, the stage-freeze guard, the public-intake security model, the
automation queue and the questionnaire tokens.

## Where things stand

- **Every planned feature is built,** including the three highest-risk
  subsystems: two-way email, the automation engine, and answer-based routing.
- **Test layers:** L1 unit, L2 component, L3 API integration and L4 database
  (pgTAP) run in CI. **There is no end-to-end (browser) suite**; journeys across
  the whole system are checked by the manual [testing-checklist.md](testing-checklist.md).
- **Deploying:** any Node host plus a Supabase project, set up with
  [self-hosting.md](self-hosting.md). An optional staging-to-production flow
  (AWS Amplify, `scripts/promote.sh`) is in [deployment.md](deployment.md).
