# Contributing to BrainBox ATS

Thanks for your interest in improving BrainBox ATS. This page covers what you
need to know before you open a pull request.

By taking part you agree to follow the [Code of Conduct](CODE_OF_CONDUCT.md).
To report a security problem, don't open an issue; follow
[SECURITY.md](SECURITY.md).

## 1. The Contributor License Agreement comes first

Before your first pull request can be merged, you sign the
[Contributor License Agreement](CLA.md). You don't need to do anything in
advance: when you open your first pull request, the **CLA Assistant** bot
comments on it with a link. Follow it, sign once, and the agreement covers all
your future contributions to this project.

In short, you keep the copyright to your work and give BrainBox Automations the
right to use it, including in its hosted product and under licenses other than
the project's public one. Read [CLA.md](CLA.md) for the full terms. If you
contribute as part of your job, make sure your employer agrees.

## 2. Talk about big changes first

- **Small fixes** (a bug, a typo, a missing test): open a pull request.
- **Anything bigger** (a new feature, a schema change, a new dependency, a
  change to how something works): open an issue first and describe what you
  want to do and why. The scope is deliberate; what the app leaves out on
  purpose is listed under "Deliberately absent" in
  [docs/architecture.md](docs/architecture.md#deliberately-absent). Agreeing on
  the approach first saves you from building something that can't be merged.

## 3. Set up

You need Node.js 22, **npm 10**, Docker and the
[Supabase CLI](https://supabase.com/docs/guides/local-development/cli/getting-started).

- **npm only.** Don't use pnpm or yarn, and don't commit any lockfile other than
  `frontend/package-lock.json`. Add or upgrade packages with npm 10
  (`npx npm@10 install <package>`): npm 11 rewrites the lockfile in a way
  `npm ci` on our hosting rejects.
- Install with `npm ci` from `frontend/`, which also installs the git hooks.

```bash
cd frontend
npm ci
```

[docs/development.md](docs/development.md) covers running the app against a
local Supabase stack, every command and the environment variables. Read
[docs/architecture.md](docs/architecture.md) before changing anything: it
explains how the code is organised and why.

## 4. Run the tests

From `frontend/`:

```bash
npm run lint
npm run type-check
npm run test:run                  # unit and component tests (L1, L2)

npm run db:start                  # a throwaway local Supabase stack (Docker)
npm run test:integration:local    # API integration tests (L3)
npm run test:db:local             # database and RLS tests (L4, pgTAP)
npm run db:stop
```

CI runs all of these, plus a secret scan and a production build, on every pull
request. The L3 and L4 suites run against a local stack and need no secrets, so
they work the same on a fork. See
[docs/testing-strategy.md](docs/testing-strategy.md) for what each layer is
for. New behaviour comes with tests; a change to row-level security comes with
a pgTAP test.

## 5. Git hooks

[Husky](https://typicode.github.io/husky/) installs two hooks during `npm ci`:

- **pre-commit** scans the staged changes for secrets with
  [gitleaks](https://github.com/gitleaks/gitleaks) (install it locally; without
  it the hook only warns, and CI still fails on a leak), then runs lint-staged:
  Prettier and `eslint --fix` on the staged files.
- **pre-push** runs lint, type-check, build and unit tests, and blocks the push
  if any of them fail.

Don't skip them with `--no-verify` on anything you want merged.

## 6. Branches, commits and pull requests

- Branch names follow `<type>/<kebab-description>`, for example
  `fix/board-filter-reset`.
- Commits and pull request titles follow
  [Conventional Commits](https://www.conventionalcommits.org/): `feat(board): add
  pagination`, `fix(email): keep cc on replies`, `docs: …`, `test: …`,
  `chore: …`.
- Fill in the [pull request template](.github/pull_request_template.md): what
  changed, why, how to verify it, and screenshots for any UI change.
- Keep a pull request to one change. Update the docs and
  `frontend/.env.example` when you change behaviour or add an environment
  variable.
- CI must pass before review.

## 7. Database migrations

The schema is the set of numbered files in `supabase/migrations/`, and deployed
databases have already applied every one of them.

- **Never edit an existing migration.** A change to an applied file never
  reaches the databases that already ran it.
- **New behaviour means a new migration,** with the next number. Comment it
  well: the schema is the contract.
- **Migrations reach production before the code.** An upgrade applies the
  migrations first and deploys the new code after, so for a while the old code
  runs against the new schema. Every migration has to work with the code that
  is running when it is applied.
- Regenerate `frontend/types/database.types.ts` and commit it with the
  migration (see [docs/development.md](docs/development.md#database-changes)).

## 8. No secrets

Never commit a key, password, token or connection string, real or "temporary".
`frontend/.env.example` holds placeholders only; your values go in
`frontend/.env.local`, which is gitignored. Never prefix a secret with
`NEXT_PUBLIC_`: that ships it to every visitor's browser. The pre-commit hook
and CI scan for secrets, but they are a safety net, not the plan.

## 9. Dependencies

Mention any new dependency in the issue or pull request and say why it is
needed. Production dependencies must be under a permissive license (MIT,
Apache-2.0, ISC or BSD).

## License

BrainBox ATS is source-available under the
[PolyForm Shield License 1.0.0](LICENSE). Your contributions are covered by the
[CLA](CLA.md).
