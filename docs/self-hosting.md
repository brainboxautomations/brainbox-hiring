# Self-hosting

How a company deploys its own copy of openHR, in order, from an empty
Supabase project to the first candidate. Each step says which environment
variables it produces; the [full table](#environment-variables) is at the end.

One deployment serves one company. Every signed-in user is a member of the
hiring team with full access to everything, so treat a staff login like a key
to all your candidate data.

To run the app on your machine for development instead, see
[development.md](development.md).

## Contents

1. [What you need](#1-what-you-need)
2. [Create the Supabase project](#2-create-the-supabase-project)
3. [Apply the migrations](#3-apply-the-migrations)
4. [Supabase Auth settings](#4-supabase-auth-settings)
5. [Create the first staff user](#5-create-the-first-staff-user)
6. [File storage (Cloudflare R2)](#6-file-storage-cloudflare-r2)
7. [Email (Resend)](#7-email-resend)
8. [Company identity and URLs](#8-company-identity-and-urls)
9. [Spam protection (Cloudflare Turnstile)](#9-spam-protection-cloudflare-turnstile)
10. [Host the app](#10-host-the-app)
11. [Automation worker](#11-automation-worker)
12. [Slack](#12-slack)
13. [Smoke test](#13-smoke-test)
14. [Upgrading](#upgrading)
15. [Optional: staging and production](#optional-staging-and-production)
16. [Environment variables](#environment-variables)

## 1. What you need

- A **Supabase** project (Postgres, Auth, `pg_cron` and `pg_net`). Supabase is
  required; the app has no other database or auth backend.
- A host that runs a **Node.js 22** app over HTTPS on a public address. Any
  Node host works; [AWS Amplify](deployment.md) is one example. The database
  calls the app's worker endpoints over the internet, so the app must be
  reachable from Supabase.
- A **Cloudflare** account for **R2** file storage (résumés, video answers,
  attachments), and optionally **Turnstile** for the captcha.
- A **Resend** account and a domain (or subdomain) you control, for sending
  and receiving candidate email.
- Optional: a **Slack** workspace, for reply notifications.
- On your machine: a clone of this repository, Node.js 22 with npm 10, and the
  [Supabase CLI](https://supabase.com/docs/guides/local-development/cli/getting-started)
  (`npx supabase` works too).

Keep a scratch list of values as you go. Everything below that is marked as an
environment variable goes into your host's environment in
[step 10](#10-host-the-app).

## 2. Create the Supabase project

Create a new project in the [Supabase dashboard](https://supabase.com/dashboard).
Pick a region close to your team and your candidates.

Check the **Postgres major version** under Project Settings → Infrastructure.
The migrations and the local test stack (`supabase/config.toml`,
`major_version = 17`) use **Postgres 17**. If your project reports a different
major version, set `major_version` in `supabase/config.toml` to match before
running the local test suites against changes you make.

From Project Settings → API, note:

| Value | Environment variable |
|---|---|
| Project URL | `NEXT_PUBLIC_SUPABASE_URL` |
| `anon` `public` key | `NEXT_PUBLIC_SUPABASE_ANON_KEY` |
| `service_role` key | `SUPABASE_SERVICE_ROLE_KEY` |

The anon key is safe in the browser: row-level security protects the data. The
**service-role key bypasses row-level security entirely.** It is used only on
the server (the inbound email webhook, the two workers and adding team
members). Never put it in a `NEXT_PUBLIC_` variable or a committed file.

## 3. Apply the migrations

The schema is the set of numbered files in `supabase/migrations/`. Apply them
with the Supabase CLI from the repository root, dry-running first:

```bash
npx supabase login
npx supabase link --project-ref <your-project-ref>
npx supabase db push --dry-run   # lists every migration that will run
npx supabase db push
```

`<your-project-ref>` is the `<ref>` in `https://<ref>.supabase.co`.

Instead of `link`, you can pass a connection string, which is also how you
apply migrations from a machine that is not logged in:

```bash
npx supabase db push --dry-run --db-url "<connection string>"
npx supabase db push --db-url "<connection string>"
```

Use the **session pooler** string (port 5432) from Project Settings → Database
→ Connection string. It contains the database password, so keep it out of files
and shell history where you can.

The migrations enable `pg_cron` and `pg_net` and create two scheduled jobs: the
automation worker every minute and the clean-up of abandoned uploads every
night. Both stay idle until [step 11](#11-automation-worker).

**Never run `supabase/seed.sql` against a real deployment.** It is sample data
for the local development stack. `supabase db push` does not run it.

## 4. Supabase Auth settings

In the Supabase dashboard:

1. **Turn off public sign-up:** Authentication → Sign In / Providers → Email →
   "Allow new users to sign up" off. This matters more than anything else on
   this page. There are no roles: **every signed-in user is full staff** and can
   read every candidate. The sign-up endpoint belongs to Supabase itself, so it
   stays open to anyone who finds your project URL unless this is off. Staff are
   added from the app's **Settings → Users** instead, which uses the admin API
   and is not affected by this setting.
2. **Turn on leaked-password protection:** Authentication → Password security,
   if your Supabase plan includes it.
3. **Set the Site URL:** Authentication → URL Configuration → Site URL =
   the app's public address, for example `https://hiring.example.com`. The
   password-reset email builds its link from it.
4. **Paste the reset-password template:** Authentication → Emails → Reset
   Password. Subject: `Reset your openHR password`. Body: the whole of
   [`supabase/templates/reset-password.html`](../supabase/templates/reset-password.html).
   Its link opens `/auth/confirm`, which only uses the token when the person
   presses Continue, so link scanners in mail filters cannot use it up.
5. **Send Auth email through your own SMTP server:** Authentication → Emails →
   SMTP Settings. Supabase's built-in sender is heavily rate-limited and only
   meant for testing. Resend offers SMTP (`smtp.resend.com`, port 465,
   username `resend`, an API key as the password) once your domain is verified
   in [step 7](#7-email-resend).

## 5. Create the first staff user

Authentication → Users → **Add user** → Create new user, with the email address
and a strong password, and **Auto Confirm User** ticked.

Users created in the dashboard have no display name. Set it in the SQL editor:

```sql
update profiles set full_name = 'Your Name' where email = 'you@example.com';
```

Everyone after the first is added from the app, under **Settings → Users**,
once it is running.

## 6. File storage (Cloudflare R2)

Every uploaded file lives in one private R2 bucket per deployment, under
`resumes/`, `videos/` and `message-attachments/`. The apply form uploads
résumés there, so the careers pages cannot take applications without it.

1. Cloudflare dashboard → R2 → **Create bucket**, for example `ats-prod`. Keep
   public access off; the app hands out short-lived signed links.
2. The bucket's Settings → **CORS policy**. Browsers upload to and preview from
   R2 directly, so allow your app's origin:

   ```json
   [
     {
       "AllowedOrigins": ["https://hiring.example.com"],
       "AllowedMethods": ["GET", "PUT"],
       "AllowedHeaders": ["Content-Type"],
       "MaxAgeSeconds": 3600
     }
   ]
   ```

3. R2 → **Manage API tokens** → create a token with **Object Read & Write**,
   scoped to this bucket only.

| Value | Environment variable |
|---|---|
| Account ID (R2 → Account details) | `R2_ACCOUNT_ID` |
| The token's Access Key ID | `R2_ACCESS_KEY_ID` |
| The token's Secret Access Key | `R2_SECRET_ACCESS_KEY` |
| The bucket name | `R2_BUCKET` |

## 7. Email (Resend)

The app sends every email through Resend from one **relay address**, for example
`talent@hiring.example.com`. The display name is the sending team member's (or
the company's, for automated email); the address is always the relay, so
candidates never see a team member's own mailbox and every reply comes back
through the relay to the app's Inbox.

**`RESEND_API_KEY` is required even if you never send email.** The careers page,
the apply form and the questionnaire submit do not load without it.

### Sending

1. Resend → Domains → **Add domain** and add the DNS records it shows. A
   subdomain such as `hiring.example.com` keeps this separate from your normal
   company mail.
2. Wait until the domain shows as verified.
3. Resend → API Keys → create a key with sending access.

| Value | Environment variable |
|---|---|
| The API key (`re_…`) | `RESEND_API_KEY` |
| The relay address, on the verified domain | `EMAIL_RELAY_ADDRESS` |

`EMAIL_RELAY_ADDRESS` has no default. While it is blank every send is refused
with a "not configured" error (503) rather than going out from someone else's
address. The careers page also shows it as the contact address when no role is
open.

### Receiving replies

Outbound works with the API key alone. Replies need two more things; until both
are set the webhook answers `503` and no reply is stored.

1. Turn on **receiving** for the relay address's domain in Resend and add the
   MX record it asks for.
2. Resend → Webhooks → **Add endpoint**:
   `https://<your-host>/api/webhooks/resend/inbound`, event `email.received`.
   Copy its signing secret (`whsec_…`) into `RESEND_WEBHOOK_SECRET`.
3. `SUPABASE_SERVICE_ROLE_KEY` must be set (step 2). The webhook has no user
   session, so it writes with that key.

Every delivery is verified against the signing secret (Svix: `svix-id`,
`svix-timestamp`, `svix-signature`, five-minute replay window) before anything
is read. An unverified request gets `401`. Mail from an address that matches no
candidate is kept in the Inbox, not dropped.

## 8. Company identity and URLs

Candidates see your company, not BrainBox. These are read at request time:

| Variable | What it does |
|---|---|
| `COMPANY_NAME` | `{{company.name}}` in emails, the sender name of automated email when a position sets none, and the careers pages' header, footer and titles. Blank gives neutral wording and sends automated email under the bare relay address |
| `COMPANY_WEBSITE_URL` | Your own site, linked from the careers header and footer, e.g. `https://www.example.com`. Blank hides the link |
| `COMPANY_LOGO_URL` | Optional logo in the careers header, about 32 px tall. Either an absolute `https://` URL, or a path starting with `/` for a file you add to `frontend/public/` (for example `/logo.png`; it ships with the build, so adding the file needs a rebuild). Blank shows `COMPANY_NAME` as text |
| `COMPANY_CAREERS_URL` | `{{company.careers_url}}` in emails, normally `https://<your-host>/careers`. Blank leaves it empty |
| `APP_BASE_URL` | The app's public address, e.g. `https://hiring.example.com`. The base of every questionnaire link (`<APP_BASE_URL>/q/<token>`), where blank falls back to the origin of `COMPANY_CAREERS_URL`, and of the link in Slack reply notifications |

The URL variables must be `http` or `https`. The bare root of the app redirects
to the careers page (`/careers`), so the host name itself is what you give
candidates; staff sign in at `/admin`.

## 9. Spam protection (Cloudflare Turnstile)

The apply form, the hosted questionnaire and their file uploads are protected by
**rate limits** in the database (migration `0048`): 10 applications per IP per
10 minutes, 5 per email address per day, 20 questionnaire submissions and 60 file
uploads per IP per 10 minutes. Every submission and upload goes through the
server; direct database and storage access for signed-out visitors is closed
(migration `0049`).

The per-IP limits use the visitor address your host passes on: CloudFront's
`cloudfront-viewer-address`, else the first `X-Forwarded-For` entry, else
`X-Real-IP`. Behind your own reverse proxy, make sure it sets one of these.

The **Cloudflare Turnstile captcha** is optional and free. To turn it on:
Cloudflare dashboard → Turnstile → **Add widget** with the site's domain, then
set `NEXT_PUBLIC_TURNSTILE_SITE_KEY` and `TURNSTILE_SECRET_KEY` (both, or
neither) and rebuild. Blank skips the captcha; the rate limits still apply.

## 10. Host the app

The app is a standard Next.js app in `frontend/`. On any Node.js 22 host:

```bash
cd frontend
npm ci
npm run build
npm run start      # listens on port 3000; set PORT to change it
```

Serve it over HTTPS, behind your host's load balancer or a reverse proxy.

**Environment variables:**

- `NEXT_PUBLIC_*` variables are inlined into the browser bundle **at build
  time**, so they must be set when `npm run build` runs, and changing one needs
  a rebuild. The build fails without the two `NEXT_PUBLIC_SUPABASE_*` values.
- Every other variable is read by the server. Set them in the environment of
  the running process, or in `frontend/.env.production` on the host (never
  committed). Changing one needs a restart.
- **Never prefix a secret with `NEXT_PUBLIC_`.** That puts it in the JavaScript
  every visitor downloads.

**AWS Amplify** is one tested option. [`amplify.yml`](../amplify.yml) at the
repository root is a working build spec; [deployment.md](deployment.md) covers
the two Amplify settings that must agree, the monorepo setting, environment
variables and redeploying.

## 11. Automation worker

Stage actions, questionnaire reminders and scheduled emails are queued in the
database and sent by a worker that `pg_cron` calls every minute. Nothing
automated is sent until the worker is configured in **two places**:

1. **`AUTOMATION_WORKER_SECRET`** in the app's environment: any long random
   string (`openssl rand -hex 32`). Blank means the worker endpoints answer
   `503` to everything. The worker also needs `SUPABASE_SERVICE_ROLE_KEY`.
2. **The same secret and the endpoint URL in the database**, in the Supabase
   SQL editor. They are kept out of migrations because migrations are public:

   ```sql
   update automation_worker_config
      set endpoint_url  = 'https://<your-host>/api/workers/scheduled-actions',
          shared_secret = '<the same value as AUTOMATION_WORKER_SECRET>',
          enabled       = true;
   ```

   That row ships blank and disabled, so a restored database never starts
   calling whatever host the previous one pointed at.

The same row switches on the **nightly clean-up of abandoned uploads** (files
uploaded on the apply form by someone who never submitted, kept 7 days first,
every deletion recorded). It uses the same endpoint host and secret:

```sql
update automation_worker_config set orphan_cleanup_enabled = true;
```

Check both are running:

```sql
select jobname, status, return_message, start_time
  from cron.job_run_details
 order by start_time desc limit 10;

-- anything here for more than a minute or two is a worker that died mid-batch;
-- stalled rows are not retried automatically, by design
select * from stalled_scheduled_actions;
select * from stalled_scheduled_messages;

select * from orphan_cleanup_runs order by started_at desc limit 5;
```

## 12. Slack

Optional. In the app: **Settings → Slack**. Paste a bot token (`xoxb-…`) and
the channel **ID** (starts with `C`, not the channel name), then turn
notifications on. The bot must be a member of that channel. The token is stored
server-side and never shown again.

## 13. Smoke test

Before you send the careers link to anyone:

- [ ] Sign in at `/admin` as the first user. Settings → Email shows a value in
      every field, not "Not set".
- [ ] Sign out, use "Forgot password", and check the email arrives and its link
      lets you set a new password.
- [ ] Confirm in the Supabase dashboard that "Allow new users to sign up" is
      off.
- [ ] Add a second team member under Settings → Users.
- [ ] Create a position, publish it as listed, and see it on `/careers` with
      your company name, logo and website link.
- [ ] Apply to it with a résumé (and the captcha, if on). The candidate appears
      on the board and the résumé previews on their profile.
- [ ] Send the candidate an email from their profile. It arrives from the relay
      address.
- [ ] Reply to it. The reply appears in the Inbox and on the profile, and Slack
      is notified if you set it up.
- [ ] Add a stage action with a short delay (send an email or a questionnaire),
      move the candidate into that stage, and check it is sent within a minute
      or two of the delay. `cron.job_run_details` shows the job succeeding.
- [ ] Open the questionnaire link and submit it.

## Upgrading

New releases are listed in [CHANGELOG.md](../CHANGELOG.md). To upgrade:

1. **Get the new code:** `git pull` (or check out the release tag) and read the
   changelog entries since your version.
2. **Back up the database**, for example with Supabase's backups or
   `pg_dump` of the `public` and `supabase_migrations` schemas.
3. **Apply the new migrations first:**

   ```bash
   npx supabase db push --dry-run
   npx supabase db push
   ```

4. **Then deploy the new code** the way you did in [step 10](#10-host-the-app).

Migrations always go in **before** the code that needs them. For the short
while in between, the old code runs against the new schema, and every migration
is written to allow that. Deploying new code against an old schema is what
breaks. `supabase db push` only applies migrations the database's own history
table does not list, so running it again is safe.

Check the changelog for new environment variables or one-off steps. Never edit
a migration that has already been applied; if you change the schema yourself,
add a new migration (see [development.md](development.md#database-changes)).

## Optional: staging and production

If you run a staging environment in front of production, each needs its own
Supabase project, R2 bucket, Resend webhook, environment variables and worker
configuration, all set up as above. [`scripts/promote.sh`](../scripts/promote.sh)
promotes a tested `main` from staging to production: it checks CI, backs up the
production database, applies only its pending migrations and then pushes the
code. See [deployment.md](deployment.md#promoting-to-production).

## Environment variables

Read only through `frontend/configurations/env-configuration.ts`, which
validates them. [`frontend/.env.example`](../frontend/.env.example) lists them
all with explanations.

| Variable | Required? | Purpose |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | **Yes**, at build time | The Supabase project URL. Public: shipped to the browser |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | **Yes**, at build time | The Supabase `anon` key. Public: shipped to the browser |
| `SUPABASE_SERVICE_ROLE_KEY` | **Yes** | The inbound email webhook, both workers and adding team members. **Bypasses row-level security**; server only. Blank means those answer 503 |
| `RESEND_API_KEY` | **Yes** | Sending email, and needed for the careers page, apply form and questionnaire submit to load at all |
| `EMAIL_RELAY_ADDRESS` | **Yes**, to send email | The address every email is sent from and replies come back to, on a domain verified in Resend. No default: blank refuses every send (503) |
| `RESEND_WEBHOOK_SECRET` | **Yes**, to receive replies | The signing secret of the Resend `email.received` webhook. Blank means the webhook answers 503 |
| `AUTOMATION_WORKER_SECRET` | **Yes**, for automation | Shared with the database (`automation_worker_config`). Stage actions, reminders, scheduled email and the upload clean-up. Blank means the workers answer 503 |
| `R2_ACCOUNT_ID` | **Yes**, for uploads | Cloudflare account ID |
| `R2_ACCESS_KEY_ID` | **Yes**, for uploads | R2 API token with Object Read & Write on this bucket only |
| `R2_SECRET_ACCESS_KEY` | **Yes**, for uploads | The same token's secret |
| `R2_BUCKET` | **Yes**, for uploads | One private bucket per deployment, with the CORS rule from step 6. Without the four `R2_*` values, uploads, previews and attachments fail |
| `APP_BASE_URL` | Recommended | The app's public address: questionnaire links (blank falls back to the origin of `COMPANY_CAREERS_URL`) and the link in Slack notifications |
| `COMPANY_NAME` | Recommended | The hiring company: `{{company.name}}`, the automated sender name, the careers pages. No default |
| `COMPANY_WEBSITE_URL` | No | Your company site, linked from the careers pages. Blank hides the link |
| `COMPANY_LOGO_URL` | No | Careers header logo: an `https://` URL or a `/path` to a file in `frontend/public/`. Blank shows the company name |
| `COMPANY_CAREERS_URL` | No | `{{company.careers_url}}`, normally `https://<your-host>/careers`. No default |
| `NEXT_PUBLIC_TURNSTILE_SITE_KEY` | No | Turnstile captcha on the public forms. Public; set at build time, together with the secret |
| `TURNSTILE_SECRET_KEY` | No | Verifies the captcha on the server. Blank skips the captcha (the rate limits still apply) |
| `NEXT_PUBLIC_API_BASE_URL` | No | Leave blank. Base URL of the app's own API; defaults to `/api` on the same origin |

`SUPABASE_DB_URL`, `L3_TEST_EMAIL` and `L3_TEST_PASSWORD` are for the test
suites only and are never read by the running app; see
[development.md](development.md#environment-variables).
