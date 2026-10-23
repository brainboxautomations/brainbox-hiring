# Deployment

The reference for one way to run openHR: a staging environment on **AWS
Amplify Hosting**, building `main` on every push, and a separate production
environment that only `scripts/promote.sh` updates (see
[Promoting to production](#promoting-to-production)).

Setting up a deployment from scratch (Supabase, Auth settings, storage, email,
the worker, environment variables) is in [self-hosting.md](self-hosting.md),
which works for any Node host. This page adds what is specific to Amplify and
to promoting.

| | |
|---|---|
| App id | `<your-amplify-app-id>` |
| Region | `<region>` |
| URL | `https://<your-staging-host>` |
| Branch | `main` (auto-build on push) |
| Build spec | [`../amplify.yml`](../amplify.yml) |

## Two settings must agree, and they live in different places

This is the whole trick, and getting it half-right fails in a way the console
does not explain.

| Setting | Level | Required value |
|---|---|---|
| `platform` | **App** | `WEB_COMPUTE` |
| `framework` | **Branch** | `Next.js - SSR` |

The commands on this page assume two shell variables:

```bash
APP_ID=<your-amplify-app-id>
REGION=<region>
```

```bash
aws amplify update-app    --app-id "$APP_ID" --region "$REGION" \
  --platform WEB_COMPUTE
aws amplify update-branch --app-id "$APP_ID" --region "$REGION" \
  --branch-name main --framework 'Next.js - SSR'
```

Set only `platform` and the build succeeds, then the deploy fails with
`CustomerError: your app's framework looks wrong`. Set neither and it is worse:
the build "succeeds", Amplify uploads the raw `.next` directory to S3 as a static
site, and every route 404s with `server: AmazonS3` in the response headers.
Nothing says the app was never actually run.

**Diagnosis in one command** — `curl -sI <url> | grep -i server`. If it says
`AmazonS3` it is deployed static and no Route Handler exists. It should say
`x-powered-by: Next.js`.

## Monorepo

The app is not at the repository root, so Amplify needs both:

- `AMPLIFY_MONOREPO_APP_ROOT=frontend` as an environment variable
- `appRoot: frontend` in `amplify.yml`

## Environment variables

Set at **app** level so every branch inherits them. `update-app` **replaces the
whole map** — a naive `--environment-variables` call silently wipes the others.
Always merge:

```bash
aws amplify update-app --app-id "$APP_ID" --region "$REGION" \
  --environment-variables "$(aws amplify get-app --app-id "$APP_ID" \
    --region "$REGION" --query app.environmentVariables --output json \
    | jq -c --arg v "$VALUE" '. + {SOME_KEY:$v}')"
```

Which variables to set, and what each one is for, is in
[self-hosting.md](self-hosting.md#environment-variables).

> **Never prefix a secret with `NEXT_PUBLIC_`.** That tells Next.js to inline the
> value into JavaScript every visitor downloads. Only public values (the
> Supabase URL and anon key, the Turnstile site key) belong on that prefix.

`amplify.yml` appends matching variables to `.env.production` during the build.
Amplify's runtime injection for SSR has been unreliable across versions; writing
the file makes it deterministic. The `|| true` on that line matters — `grep`
exits non-zero when nothing matches, which would otherwise fail the build.

**Environment variables are read at build time.** Changing one requires a
redeploy; it does not take effect on the running app.

```bash
aws amplify start-job --app-id "$APP_ID" --branch-name main \
  --job-type RELEASE --region "$REGION"
```

## Inbound email webhook

Resend endpoint: `<url>/api/webhooks/resend/inbound`, event `email.received`.
The signing secret from that endpoint is `RESEND_WEBHOOK_SECRET`. Setup is in
[self-hosting.md](self-hosting.md#receiving-replies).

Verified against the deployed app:

| Request | Response |
|---|---|
| No signature headers | 401 `Missing signature headers` |
| Stale timestamp | 401 `outside the tolerance window` |
| Fresh timestamp, bad signature | 401 `Signature does not match` |
| Secret not configured | 503 — fails closed, never accepts unverified mail |

**Still unproven, and only a real email can settle it:** that a *genuine* Resend
signature verifies. The test suite proves the implementation agrees with itself,
not that it agrees with Resend.

## Promoting to production

Staging and production are separate environments: separate Supabase projects,
separate hosting apps, separate environment variables. Production does not build
from this repository. It builds from a separate private repository (the **prod
repo**), and the only thing that pushes to it is `scripts/promote.sh`, which
brings the production database's schema up to date first. Nobody pushes to the
prod repo by hand.

```
pull request ──► main ──► CI
                   │
                   ├──► staging host builds main
                   │
                   └──► scripts/promote.sh
                          1. local main matches origin, and CI passed on it
                          2. preview the commits and the pending migrations
                          3. back up the production database
                          4. apply only the pending migrations to it
                          5. push main to the prod repo ──► production host builds it
```

Only schema migrations move between environments. The script never copies data,
never runs `supabase/seed.sql` against production and never touches secrets:
production keeps its own data and its own environment variables on its host,
set up the same way as staging's above.

**Migrations land before the code.** Step 4 runs before step 5, so for a short
while production runs the old code against the new schema. Every migration has
to work with the code production is running at that moment. A migration whose
header says to apply it only after some code is live ships in a later promote
than that code.

### One-time setup on your machine

1. **Tools:** `git`, `gh` (logged in with `gh auth login`), the Supabase CLI,
   `psql` and `pg_dump`.
2. **The prod remote:**

   ```bash
   git remote add prod <prod-repo-url>
   ```

3. **The config file:**

   ```bash
   cp scripts/.env.promote.example scripts/.env.promote
   ```

   Set `EXPECTED_PROD_DB_REF` to the production Supabase project ref: the
   `<prod-ref>` in `https://<prod-ref>.supabase.co`. The file is gitignored, so
   everyone who promotes keeps their own copy. Every other variable in it has a
   default (see [Configuration](#configuration)).

**Why the ref matters.** Before it connects to anything, the script checks that
`PROD_DB_URL` contains `EXPECTED_PROD_DB_REF`, and stops if it does not. A
staging connection string left in your shell, or a string pasted for the wrong
project, cannot be migrated as if it were production.

**The database connection string is never written into a file in the repo.**
Export it in the shell you promote from, each time:

```bash
export PROD_DB_URL="postgresql://postgres.<prod-ref>:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres"
```

Take the **session pooler** string, port 5432, from Supabase → Project Settings →
Database → Connection string. The direct `db.<prod-ref>.supabase.co` host is
IPv6-only and unreachable from many networks. Keep the string out of
`scripts/.env.promote` too: it carries the production database password.

### Every promote

1. **CI is green on `main`** for the commit you are about to ship. The script
   checks this itself; wait for CI rather than reaching for `--skip-ci-check`.
2. **Dry run first, and read it:**

   ```bash
   ./scripts/promote.sh --dry-run
   ```

   It lists the commits production does not have yet and the migrations the
   production database has not applied. Check that every pending migration is
   one you expect, and that none of them needs code production does not run yet
   (see "Migrations land before the code" above).
3. **Run it:**

   ```bash
   ./scripts/promote.sh
   ```

   It repeats the preview, then asks you to type `promote` before it changes
   anything in production.
4. **Watch the production build** in the host's console. Production is live
   when the build goes green.

The script switches your working copy to `main` and refuses to run with
uncommitted changes, so commit or stash first.

What each step does:

| Step | What happens |
|---|---|
| 1. Sync and check CI | Checks out `main`, fast-forwards it from `origin` and fetches the prod remote. Then asks GitHub (`gh run list`) for the `CI` workflow's run on that exact commit. Anything but a finished, successful run stops the script. |
| 2. Preview | Lists the commits that will ship (`prod/main..main`), connects to the production database and prints `supabase db push --dry-run`: the migrations its history table does not have yet. `--dry-run` stops here. |
| 3. Back up | `pg_dump` (custom format) of the `public` and `supabase_migrations` schemas. Skipped on the first promote, when there is nothing to back up. |
| 4. Migrate | `supabase db push` against `PROD_DB_URL`. Only migrations missing from the database's own history run. Rows are never copied or deleted. |
| 5. Push | `git push prod main:main`. The production host builds from that push. |

**Backups** are written to `~/prod-db-backups/` (or `PROMOTE_BACKUP_DIR`) as
`prod-<timestamp>-before-<commit>.dump`, on your machine and nowhere else. They
hold the app's tables and the migration history, not Supabase Auth users or
uploaded files. They also hold candidate data, so keep them as carefully as the
production database itself.

**If it stops:**

- **Before anything in production changes.** Every precondition is checked
  first: the tools, the prod remote, `EXPECTED_PROD_DB_REF` and `PROD_DB_URL`
  (and that they match), `gh` being logged in, a clean working tree, CI on the
  commit, and a working connection to the production database. Fix what the
  error names and run it again.
- **In step 3 or 4.** The script stops at the first failing command. Migrations
  are applied before the code is pushed, so step 5 never runs and the new code
  is not deployed; production keeps running the previous release. Read the
  output to see which migrations were applied, fix the cause, and promote
  again. The backup from step 3 is there if you need it.
- **In step 5.** The database is already migrated; only the push failed. Fix the
  push (access to the prod repo, usually) and run the script again. With nothing
  left to apply, step 4 does nothing.

### Flags

| Flag | What it does | When to use it |
|---|---|---|
| `--dry-run` | Runs the checks and the preview, then stops. Changes nothing in production. A dirty working tree is a warning instead of an error. | Before every real promote. |
| `--yes` | Skips the "type `promote`" confirmation. | Only when something else has already confirmed the release. Not for a promote you run by hand. |
| `--skip-db` | No backup and no migrations: pushes the code only. `EXPECTED_PROD_DB_REF`, `PROD_DB_URL`, `psql`, `pg_dump` and the Supabase CLI are not needed. | The exception: a release with no pending migrations, from a machine without database access. If a migration is pending, the code ships without it. |
| `--skip-ci-check` | Skips the GitHub CI check, so `gh` is not needed. | The exception: CI itself is broken for a reason that has nothing to do with the code, and you have run the checks locally. |

Flags combine, for example `--dry-run --skip-db`.

### Configuration

`scripts/.env.promote` is read as bash. A variable already exported in your
shell wins over the file.

| Variable | Default | What it is |
|---|---|---|
| `EXPECTED_PROD_DB_REF` | none; required unless `--skip-db` | The production Supabase project ref. `PROD_DB_URL` must contain it |
| `DEV_REMOTE` | `origin` | The remote `main` is pulled from |
| `DEV_BRANCH` | `main` | The branch that is promoted |
| `PROD_REMOTE` | `prod` | The prod repo's remote |
| `PROD_BRANCH` | `main` | The prod repo branch the production host builds from |
| `DEV_REPO` | read from the `DEV_REMOTE` URL | The GitHub `<owner>/<repo>` whose CI must have passed |
| `CI_WORKFLOW` | `CI` | The GitHub Actions workflow to check |
| `PROMOTE_BACKUP_DIR` | `$HOME/prod-db-backups` | Where backups are written |

`PROD_DB_URL` is deliberately not in this table: export it in your shell, as
above.

### The first promote to a new production environment

When the production database has no migration history yet, the script skips
the backup and applies every migration. When the prod repo is empty, the push
seeds it with the full history. At the end it prints the steps that are still
manual:

1. **Point the automation worker at production**, in the production project's
   SQL editor:

   ```sql
   update automation_worker_config
      set endpoint_url  = 'https://<prod-host>/api/workers/scheduled-actions',
          shared_secret = '<same value as AUTOMATION_WORKER_SECRET on the production host>',
          enabled       = true;
   ```

2. **Create the first staff user** in Supabase Auth. Later staff are added from
   Settings → Users.
3. **Smoke-test:** the list in [self-hosting.md](self-hosting.md#13-smoke-test).

The rest of [self-hosting.md](self-hosting.md) applies to production too: Auth
settings, storage, the captcha, inbound email and Slack.

## Notes

- Next.js 16 builds and runs on Amplify (confirmed on 16.2.6). 16.2.6 has known
  security advisories; upgrade to 16.3.6 or later.
- **Amplify installs with `npm ci`**, which fails if `package-lock.json` does not
  match `package.json` exactly. Add packages with npm 10 (`npx npm@10 install`):
  npm 11 has rewritten the lockfile in a way `npm ci` rejected.
- The worker endpoint URL and secret also live in the database
  (`automation_worker_config`); see
  [self-hosting.md](self-hosting.md#11-automation-worker).
- The L3 integration suite shells out to `psql`. In some sandboxed environments
  that fails with `could not translate host name ... pooler.supabase.com`. That is
  the sandbox, not the code — the same command works unsandboxed.
- Staging and production are separate Supabase projects, each with its own
  credentials. The L3 and L4 test suites run against a throwaway local stack
  (see [development.md](development.md#running-the-l3-and-l4-suites-locally));
  no test ever points at production.
