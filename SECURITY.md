# Security policy

openHR stores personal data about job candidates, so we take security
reports seriously. Thank you for helping keep its users safe.

## Supported versions

Security fixes go into the **latest release** only. If you run an older
version, upgrade to the latest release to get fixes (see
[docs/self-hosting.md](docs/self-hosting.md#upgrading)).

| Version | Supported |
|---|---|
| Latest release | Yes |
| Anything older | No |

## Reporting a vulnerability

**Please do not report security problems in public issues, pull requests or
discussions.**

Report privately, in one of two ways:

1. **GitHub private vulnerability reporting (preferred):** on this repository,
   open the **Security** tab and choose **Report a vulnerability**.
2. **Email:** `dev@brainboxautomations.com`, if you can't use GitHub.

Please include as much of this as you can:

- What the problem is and what an attacker could do with it.
- The version, release or commit you tested.
- Steps to reproduce, or a proof of concept.
- Any configuration it depends on (for example, a particular environment
  variable or Supabase setting).
- Whether you know of it being exploited or disclosed anywhere.
- How you would like to be credited, if at all.

Only test against an installation you run yourself. Don't access, change or
delete other people's data, and don't test against deployments you do not own.

## What happens next

- We aim to acknowledge your report within a few working days.
- We will look into it, tell you whether we can reproduce it, and keep you
  updated while we work on a fix.
- When a fix is ready we release it and publish a security advisory on this
  repository. We are happy to credit you unless you prefer otherwise.

Please give us a reasonable chance to release a fix before you disclose the
problem publicly.

## Scope

In scope: the code in this repository, including the database migrations and
their row-level security policies, the API routes, the public careers pages and
forms, and the default configuration.

Out of scope:

- Problems in a particular deployment caused by its own setup, such as leaving
  public sign-up enabled in Supabase (see
  [docs/self-hosting.md](docs/self-hosting.md#4-supabase-auth-settings)).
- Vulnerabilities in third-party services the app uses (Supabase, Cloudflare,
  Resend, Slack). Report those to the service.
- Denial-of-service by sheer traffic volume, spam, and social engineering.
