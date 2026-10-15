# Development

How to run BrainBox ATS on your machine, the commands, the git hooks, schema
changes and the test suites. To deploy your own copy for real use, follow
[self-hosting.md](self-hosting.md) instead. Before contributing, read
[CONTRIBUTING.md](../CONTRIBUTING.md).

## Repository layout

| Path        | What it is                                                                                                                                                  |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `frontend/` | The Next.js app: staff app, public careers pages, the hosted questionnaire, and the `/api/*` Route Handlers. Owns `package.json`, so **run npm from here.** |
| `supabase/` | Migrations (the schema is the contract), pgTAP tests and the test runner, the local stack config, the reset-password email template.                        |
| `scripts/`  | `local-supabase-env.mjs` (local stack values for the test suites) and `promote.sh` (staging to production).                                                 |
| `docs/`     | Architecture, testing, development, self-hosting and deployment. **Start at [README.md](README.md).**                                                        |

## Prerequisites

- **Node.js 22** and **npm 10**
- **Docker** (Docker Desktop or any engine the Supabase CLI supports)
- The [Supabase CLI](https://supabase.com/docs/guides/local-development/cli/getting-started)
- `psql` on your `PATH` (the L3 and L4 suites use it)
- Optional: [gitleaks](https://github.com/gitleaks/gitleaks), for the
  pre-commit secret scan

## Run the app locally

```bash
cd frontend
npm ci
npm run db:start                 # a local Supabase: every migration plus supabase/seed.sql
node ../scripts/local-supabase-env.mjs   # prints the local URL and keys
cp .env.example .env.local
```

In `frontend/.env.local`, set:

- `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` and
  `SUPABASE_SERVICE_ROLE_KEY` to the values the script printed. They are the
  CLI's public local defaults, not secrets.
- `RESEND_API_KEY` to any placeholder, such as `re_local_placeholder`. The
  careers pages, the apply form and the questionnaire submit need it to be set
  even though only email uses it. Leave `EMAIL_RELAY_ADDRESS` blank and every
  send is refused, so nothing goes out by accident.

The local stack has no users. Create one with the Auth admin API, using the
URL and service-role key the script printed:

```bash
curl -X POST "<NEXT_PUBLIC_SUPABASE_URL>/auth/v1/admin/users" \
  -H "apikey: <SUPABASE_SERVICE_ROLE_KEY>" \
  -H "Authorization: Bearer <SUPABASE_SERVICE_ROLE_KEY>" \
  -H "Content-Type: application/json" \
  -d '{"email":"you@example.com","password":"a-long-local-password","email_confirm":true,"user_metadata":{"full_name":"Your Name"}}'
```

Then start the app:

```bash
npm run dev
```

Open http://localhost:3000/admin and sign in. The bare root opens the public
careers page; public routes (`/careers`, `/q/<token>`) work without a session.
The seed adds sample pipelines and positions.

File uploads (résumés, video answers, attachments) need a Cloudflare R2 bucket
and the four `R2_*` variables; there is no local stand-in. Everything else
works without them. `npm run db:stop` stops the stack and discards its data.

### npm only

**Use npm, not pnpm or yarn.** The lockfile is `package-lock.json` and hosts
such as Amplify install with `npm ci`. Add or upgrade packages with npm 10
(`npx npm@10 install <package>`): npm 11 rewrites the lockfile in a way
Amplify's `npm ci` rejects.

On a slow connection, big packages like `next` can time out mid-download.
Install one at a time with longer timeouts:

```bash
npm ci --maxsockets=1 --fetch-timeout=600000 --fetch-retries=5
```

## Commands

All run from `frontend/`:

| Command                          | Purpose                                                                  |
| -------------------------------- | ------------------------------------------------------------------------ |
| `npm run dev`                    | Dev server                                                               |
| `npm run build`                  | Production build. Fails without the `NEXT_PUBLIC_SUPABASE_*` variables.  |
| `npm run start`                  | Serve a production build                                                 |
| `npm run lint`                   | ESLint                                                                   |
| `npm run type-check`             | `tsc --noEmit`                                                           |
| `npm run test`                   | Unit and component tests, watch mode                                     |
| `npm run test:run`               | Unit and component tests, single run (what CI and the pre-push hook run) |
| `npm run test:coverage`          | The same with V8 coverage                                                |
| `npm run db:start`               | Start a throwaway local Supabase stack (Docker)                          |
| `npm run db:stop`                | Stop it and discard its data                                             |
| `npm run test:integration:local` | API integration tests (L3) against the local stack, see below            |
| `npm run test:db:local`          | pgTAP database tests (L4) against the local stack, see below             |
| `npm run test:integration`       | L3 against whatever project the environment points at                    |
| `npm run test:db`                | L4 against whatever database the environment points at                   |
| `npm run format`                 | Prettier over the whole app                                              |

## Git hooks

Husky installs them during `npm ci`.

- **pre-commit** scans the staged changes for secrets with gitleaks (a warning,
  not a failure, if gitleaks is not installed; CI enforces it), then formats and
  auto-fixes the staged files (Prettier, then `eslint --fix`).
- **pre-push** runs lint, type-check, build and unit tests, and blocks the push
  if any fail. It also warns when your branch is behind `origin/main`.

CI (`.github/workflows/ci.yml`) runs the same four checks, gitleaks over the
full history, and the L3 and L4 suites on every push and pull request. The L3
and L4 jobs start their own local Supabase stack and read no repository
secrets, so they run the same on a pull request from a fork.

## Environment variables

Read only through `frontend/configurations/env-configuration.ts`, which
validates them. Names and explanations are in `frontend/.env.example`; the full
table, with what each one is needed for, is in
[self-hosting.md](self-hosting.md#environment-variables).

Variables used only in development:

| Variable                          | Needed for                                                                                                          |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `SUPABASE_DB_URL`                 | Only the L3 / L4 suites, and only against a hosted project (the `:local` scripts supply it). Contains a password    |
| `L3_TEST_EMAIL`, `L3_TEST_PASSWORD` | Optional fixed account for L3. Blank means the suite creates a throwaway user per run                             |
| `NEXT_PUBLIC_API_BASE_URL`        | Base URL of the app's own API. Blank means `/api` on the same origin, which is right for every normal deployment    |

**Never prefix a secret with `NEXT_PUBLIC_`.** That puts it in the JavaScript
every visitor downloads.

## Database changes

**Every schema change is a new numbered migration** in `supabase/migrations/`.
Never edit an existing migration and never change the database by hand.
Deployed databases have already applied the existing files, so an edit would
never reach them.

Migrations reach a deployed database **before** the code that goes with them
(see [self-hosting.md](self-hosting.md#upgrading) and
[deployment.md](deployment.md#promoting-to-production)), so every migration has
to work with the code that is running when it is applied.

Try a migration on the local stack first: `npm run db:stop` then
`npm run db:start` rebuilds it from every migration. Apply to a hosted project
with the Supabase CLI from the repo root, always dry-running first:

```bash
npx supabase db push --dry-run   # shows exactly which migrations will run
npx supabase db push
```

Then **regenerate the database types** and commit them with the migration:

```bash
npx supabase gen types typescript --project-id <your-project-ref> > frontend/types/database.types.ts
```

or, against the local stack, `npx supabase gen types typescript --local >
frontend/types/database.types.ts` from the repo root.

`frontend/types/database.types.ts` is generated, so never hand-edit it. Every
Supabase client is typed with it, which turns a renamed or dropped column into a
compile error. It is generated from a **running** schema, so a migration that
hasn't been applied yet won't appear. If `npm run type-check` fails on a column
that plainly exists, regenerate first. The pre-push hook's type-check catches a
forgotten regeneration.

`.select()` strings are written as single string literals, because supabase-js
infers the row type from the literal and concatenating one loses that.

## Running the L3 and L4 suites locally

Both suites run against a throwaway local Supabase stack, the same way CI runs
them. No hosted project, account or secret is needed. The layers and what each
covers are in [testing-strategy.md](testing-strategy.md).

```bash
cd frontend
npm ci
npm run db:start                  # applies every migration and supabase/seed.sql
npm run test:integration:local    # L3
npm run test:db:local             # L4
npm run db:stop                   # stops the stack and discards its data
```

The first `db:start` downloads about 600 MB of images, which takes a few minutes
on a fast connection. After that a start takes about 30 seconds, L4 a few seconds
and L3 about 20 seconds. `db:start` skips the services the suites never touch
(Studio, Storage, Realtime, Mailpit and so on); a plain `supabase start` from the
repo root brings up the full stack and works too.

The `:local` scripts read the stack's URL, keys and database URL from
`supabase status` and pass them to the suite, overriding anything in
`frontend/.env` or `frontend/.env.local`. They are the CLI's public local
defaults, not secrets. To use them in your own shell instead, run
`node ../scripts/local-supabase-env.mjs`, which prints them as `NAME=value`
lines.

## Integration tests (L3)

`frontend/tests/integration/*.test.ts` call the `/api/*` Route Handlers against a
real Supabase: Postgres, Auth and PostgREST. They are a separate Vitest project
(`vitest.integration.config.ts`) and are not part of `npm run test:run`, so the
default suite stays offline.

They need the project URL, anon key, service-role key and `SUPABASE_DB_URL`,
because the suite creates and deletes its own throwaway user in SQL.
`npm run test:integration:local` supplies all four from the local stack.

**No test sends real email.** The Resend transport is mocked and the config
replaces `RESEND_API_KEY` with a placeholder for the whole run. Don't "fix"
either by supplying a real key. File storage (R2) is mocked the same way, so no
storage credentials are needed.

## Database tests (L4)

`supabase/tests/*.test.sql` are pgTAP suites covering constraints, functions and
RLS policies. RLS is the whole authorisation model, so this layer is what stands
between a policy change and a data leak.

```bash
cd frontend
npm run test:db:local          # every suite
npm run test:db:local -- 03    # only files whose name contains "03"
```

Every suite runs inside `begin; … rollback;`, so a run leaves no rows behind.

**CI** starts a local stack in the job, runs the suite against it and fails
loudly on any `not ok`, missing plan or SQL error, rather than skipping and
reporting green.

### Optional: against a hosted project

If you maintain a hosted Supabase project, `npm run test:integration` and
`npm run test:db` (without `:local`) run against whatever `frontend/.env` and
`frontend/.env.local` point at. Both write to that database (L3 creates and
deletes rows and a test user; L4 rolls back), so use a development project,
never production.

- L3 needs `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
  `SUPABASE_SERVICE_ROLE_KEY` and `SUPABASE_DB_URL`.
- L4 uses `psql` when `SUPABASE_DB_URL` is set. Take the **session pooler**
  string (port 5432, not the transaction pooler on 6543) from Supabase → Project
  Settings → Database → Connection string. Without it, the runner falls back to
  `supabase db query --linked`, through the credentials you already have from
  `supabase login` and `supabase link`.

## Ground rules

- **The scope is deliberate.** What the app leaves out on purpose is listed
  under "Deliberately absent" in [architecture.md](architecture.md#deliberately-absent);
  check there before building something outside it.
- **Follow the layering.** Component → hook → service → Route Handler → Supabase.
  `snake_case` in the database, `camelCase` in the API types; mappers in
  `app/api/_mappers.ts` are the only place the two meet.
- **Every staff route requires a login, checked twice:** the proxy redirects to
  `/login`, and every `/api/*` handler calls `requireUser()` itself.
- **Handle empty, loading and error states,** not just the happy path. A control
  that hides a failure is worse than one that shows it.
- **Comments explain why, not what.** Name things so the code reads on its own;
  comment the decisions it can't show. Long explanations belong in
  [architecture.md](architecture.md) ("Design decisions worth knowing").
  Comment SQL migrations well, because the schema is the contract.
- **Schema changes are migrations** (see above).
- **Keep lint at zero warnings.** The pre-push hook and CI fail on lint errors;
  warnings don't block, so don't let them pile up.
- **Flag new dependencies before adding them,** in the issue or pull request.
