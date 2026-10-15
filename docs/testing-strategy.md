# Testing strategy

Five layers, each with a distinct job. Four run in CI; the fifth, end-to-end,
is planned and not built. No layer is scaffolded before there is something for
it to test.

## Why this shape

Two properties of this system drive the plan:

1. **The core feature is a time-delayed, cancellable job queue.** Delay,
   cancel-on-move, fire-on-first-entry and reminder stop-conditions cannot be
   verified by clicking around — you would have to wait an hour per assertion.
   They need a fake clock and direct queue inspection. This is L1 and L3 work,
   and it is non-negotiable.

2. **RLS _is_ the authorisation model.** There are no roles, so
   "authenticated" versus "anon" policies are the entire security boundary. A
   policy regression is silent — the app keeps working, it just leaks. Only L4
   catches that, and it has happened once already: unlisted positions were
   enumerable by `anon` until migration `0009`.

## The layers

| Layer              | Tool                                   | Scope                                                                                                                     | Runs where                 |
| ------------------ | -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- | -------------------------- |
| **L1** Unit        | Vitest                                 | Pure logic: mappers, merge-variable resolution, delay arithmetic, routing resolution, slug generation, video-link parsing | CI, every push             |
| **L2** Component   | Vitest + React Testing Library         | Rendered behaviour: forms, the questionnaire builder, board interactions, empty/loading/error states                      | CI, every push             |
| **L3** Integration | Vitest + Supabase (local stack)        | `/api/*` handlers against a real Postgres: auth gates, validation, error paths, the queue worker under a fake clock       | CI, every push             |
| **L4** Database    | pgTAP                                  | RLS policies, `submit_application`, `snapshot_pipeline_to_position`, constraints, triggers                                | CI, every push             |
| **L5** E2E         | Playwright (**not built**)             | The primary flow: apply → board → automated email → reply → move → hire                                                   | —                          |

### L1 — Unit (live now)

Colocated as `*.test.ts` next to the module. Covers, among others,
`utilities/slug.ts`, `utilities/video-link.ts`, `utilities/merge-variables.ts`,
`utilities/email-address.ts`, `utilities/rich-text.ts`,
`utilities/message-attachments.ts`, `utilities/email-headers.ts`,
`utilities/thread-matching.ts`, `utilities/webhook-signature.ts`,
`utilities/relative-time.ts`, `middlewares/auth-middleware.ts`,
`utilities/candidate-filters.ts`, `utilities/candidate-export.ts` and
`utilities/bulk-action-outcome.ts`.

`video-link.test.ts` is the model to follow for anything on a trust boundary:
the rejection cases carry more weight than the happy paths, because that
function is what stops an applicant putting an arbitrary iframe in front of an
internal reviewer.

The outbound email suites are written the same way, and the weight is deliberately on the
failure side:

- `merge-variables.test.ts` — the unresolved-token cases outnumber the happy path
  several times over. A candidate seeing `Hi {{candidate.first_name}},` is the
  failure that actually reaches a human, so every malformed shape is enumerated
  (`{{}}`, `{{candidate}}`, `{{.first_name}}`, unknown group, unknown field,
  doubled braces, unterminated) and each asserts the output contains no braces.
- `email-address.test.ts` — header injection. A display name is user-controlled
  and goes straight into a `From:` header; the tests are mostly about what gets
  stripped.
- `rich-text.test.ts` — the link allowlist and HTML escaping, including the
  composed property that actually matters: markup arriving _through a merge
  variable_ still cannot become markup or a `javascript:` link.

The inbound email suites follow the same rule — the interesting cases are the hostile ones:

- `webhook-signature.test.ts` — the inbound webhook is a public endpoint that
  writes to the database, so the signature is its entire authentication. The
  tests are almost all rejections: tampered payload, foreign secret, swapped
  delivery id, replayed timestamp, missing headers, and the two fail-closed
  cases where the secret is absent or is not valid base64.
- `email-headers.test.ts` — header parsing on untrusted input. A `References`
  chain of 200 ids is capped, junk tokens are dropped rather than passed to a
  query, and `htmlToPlainText` is asserted to lose `<script>` and `<style>`
  content entirely, because inbound HTML is never rendered.
- `thread-matching.test.ts` — the decision that keeps a forged `In-Reply-To` out
  of another candidate's history. The "foreign reference" cases are the point of
  the file.
- `auth-middleware.test.ts` — a guard: `/api/webhooks/` is unauthenticated and
  everything else is not, and no lookalike path (`/api/webhooksfake/…`) slips
  through.

The board and bulk-action suites keep the same bias:

- `candidate-filters.test.ts` — the boundaries, not the middle. Exactly on the
  day boundary, one millisecond past it, a future timestamp (clock skew must not
  read as stale), and an unparseable one. `now` is injected precisely so these
  are assertable.
- `candidate-export.test.ts` — CSV escaping is a trust boundary. A candidate's
  own name, headline and application answers land in a file an internal reviewer
  opens in Excel, so the tests are mostly about what gets neutralised:
  `=HYPERLINK(…)`, `+`, `-`, `@`, embedded quotes, embedded newlines.
- `bulk-action-outcome.test.ts` — the wording a user actually reads after a
  partial run. The assertion that matters is that the copy says the successful
  ones went through: a partial result misread as a rollback is worse than the
  failure.

```bash
cd frontend && npm run test:run
```

### L2 — Component

React Testing Library, already installed. Setup lives in `frontend/tests/setup.ts`
and stubs `ResizeObserver` and `matchMedia`, which jsdom lacks and both the board
drag interactions and the video recorder touch.

Query by role and accessible name, not by class. The board and the builder are
the two screens where component tests pay for themselves — both hold significant
local state that is painful to reach through E2E.

**Definition of done for a component test:** it asserts the empty, loading and
error states, not just the populated one. Handling those states is a ground
rule for every change (see [development.md](development.md#ground-rules)); this is where it gets enforced.

Examples: `edit-position-screen.test.tsx`,
`components/organisms/bulk-action-bar.test.tsx` and
`app/(app)/positions/[positionId]/board/pipeline-board-screen.test.tsx`.

The board followed the edit screen's shape: `page.tsx` is a thin wrapper reading
`useParams`, and the screen is a plain component taking `positionId`, so the
whole board can be rendered with its hooks mocked. That is what makes the bulk
bar's partial-failure path assertable — the harness resolves the bulk mutation
with three updated rows and one failure, and the spec checks that the failing
candidate is named, that the copy says the rest went through, and that exactly
the failures remain selected.

The export spec stubs `URL.createObjectURL` and `HTMLAnchorElement.click`; it
asserts a download was started rather than reading bytes, because the file's
contents are already covered at L1.

### L3 — API integration

Route Handlers exercised against a real Supabase, not mocks. Mocking the Supabase
client here would test the mock, and the interesting failures are all at the
boundary — RLS denials, constraint violations, the `on conflict` path in
`submit_application`.

```bash
cd frontend
npm run test:integration
```

This layer also covers the **inbound webhook**, which is where
idempotency, signature rejection and Person matching have to be proven —
`tests/integration/inbound-webhook.test.ts` and
`tests/integration/threads.test.ts`.

It also covers the bulk routes —
`tests/integration/bulk-candidates.test.ts`. Those are where partial
failure has to be proven against a real database rather than a fake: the suite
seeds two positions, asks to move candidates from one into a stage belonging to
the other, and asserts each is refused individually while the eligible ones are
written.

The webhook needs two seams the send path did not:

- **The transport fake gained an inbound side.** `queueInboundEmail` registers
  what `emails.receiving.get` should return, `queueInboundAttachment` registers
  attachment bytes, and `inboundFetchCount` records how many times the relay was
  asked. That last one is an assertion, not a diagnostic: a retried delivery must
  cost **zero** extra API calls, and the test proves it.
- **The service-role client is mocked at the module boundary**, the same way the
  transport is, and stands in the signed-in test user's client. That keeps the
  real Route Handler, the real RLS-backed database and the real signature check
  in the loop without the webhook specs needing a service-role key.

`RESEND_WEBHOOK_SECRET` is a fixed placeholder in `vitest.integration.config.ts`;
the specs sign their own payloads with it. The rejection cases assert not only
the `401` but that the relay was never called, because an unverified request
that still costs an API call is a denial-of-wallet hole.

#### Where it runs

**The same place L4 runs: a throwaway local Supabase stack** (`npm run db:start`,
Docker plus the Supabase CLI). `supabase start` builds the database from the same
`supabase/migrations/` the hosted projects run, so the RLS policies L3 leans on
are the real ones, then applies `supabase/seed.sql`. CI starts one stack per job,
so a run needs no secrets, works on a pull request from a fork and never writes to
a shared project. `npm run test:integration:local` reads the stack's URL, keys and
database URL from `supabase status` (`scripts/local-supabase-env.mjs`) and runs the
suite with them. The commands and timings are in [development.md](development.md#running-the-l3-and-l4-suites-locally).

Pointing it at a hosted development project still works: `npm run
test:integration` without `:local` uses whatever `frontend/.env` and
`frontend/.env.local` hold. Suites are written so two runs cannot collide even
on a shared project: every fixture is seeded with `crypto.randomUUID()`-derived
slugs and emails, and each spec deletes its own rows in `afterAll`.

Config is `vitest.integration.config.ts` — a **second** Vitest project, because L3
needs `environment: "node"` (Route Handlers, `NextRequest`, `FormData`) where
L1/L2 need jsdom. `tests/integration/**` is excluded from the default config, so
`npm run test:run` never picks these up and never touches the network.

#### How a handler is driven

Handlers are imported and called directly — no HTTP server.

- **Auth is real, not stubbed.** `next/headers` is mocked to return an in-memory
  cookie jar (`tests/integration/_cookie-jar.ts`). `@supabase/ssr` signs a test
  user in _through that jar_, so it ends up holding genuine, correctly-chunked
  Supabase session cookies and `requireUser()` runs for real. Clearing the jar is
  how the 401 cases are exercised — the gate is tested, not skipped.
- **The test user is seeded in SQL**, by `globalSetup`, through the same runner L4
  uses (`psql` when `SUPABASE_DB_URL` is set, which the `:local` script always
  does, otherwise `supabase db query --linked`). It is deliberately _not_ created through `auth/v1/signup`: signup
  sends a confirmation email, which is both a real email and rate-limited — the
  first attempt hit `over_email_send_rate_limit`. Seeding writes `auth.users` and
  `auth.identities` directly with a `pgcrypto` bcrypt hash. **The eight GoTrue
  token columns must be `''`, not null**, or the password grant answers
  `500 Database error querying schema`.
- **Teardown deletes the user**, and setup additionally sweeps any L3 user older
  than an hour, so a killed run cannot leave the project dirty.

#### No test ever sends real email

Two independent guarantees, because one is not enough for something irreversible:

1. `@/configurations/email-transport` is **mocked at the module boundary**, so
   `new Resend(...)` is never constructed. The fake records every payload, which
   is what the assertions read, and can be told to reject so the 502 path is
   covered too.
2. `vitest.integration.config.ts` overwrites `RESEND_API_KEY` with a placeholder
   for the whole run, so even a mis-wired mock has no credential to send with.
   The CI job sets the same placeholder; it has no access to the real key.

The `EmailTransport` type is the seam. It is the only place the provider SDK is
touched, which is what makes both guarantees cheap.

#### The queue worker

**It is tested at three layers rather than one.** No fake
timers were needed: every scheduling function takes `p_now` as a parameter and
the worker takes `{ now }`, so a delay is asserted by passing an instant rather
than by advancing a clock.

Where each case landed:

| Case                                                                              | Layer                                                      |
| --------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| An action scheduled with a delay does not fire before `scheduled_for`             | L4 `09` + L3 `scheduled-actions-worker`                    |
| Moving the candidate out of the originating stage cancels pending actions         | L4 `09` + L3 `stage-actions`                               |
| An already-sent action is _not_ recalled by a subsequent move                     | L4 `09`                                                    |
| A row a worker has already claimed is not cancelled either                        | L4 `09`                                                    |
| The worker re-checks stage membership at execution time                           | L1 `scheduled-action-plan` + L3 `scheduled-actions-worker` |
| Re-entering a stage does not re-fire its actions                                  | L4 `09` + L3 `stage-actions`                               |
| A due action is claimed exactly once, however many workers run                    | L4 `09` + L3 `scheduled-actions-worker`                    |
| Illegal state transitions are impossible                                          | L4 `09`                                                    |
| A failure or skip cannot be recorded without a reason                             | L4 `09`                                                    |
| A public application fires the first stage through the same producer              | L4 `09`                                                    |
| An unresolvable routing target resolves to nothing, never a guess                 | L4 `09` + L1 `scheduled-action-plan`                       |
| Reminders stop on each of the four stop conditions                                | L4 `10` + L1 `scheduled-action-plan` + L3 `scheduled-actions-worker` |
| A reminder run is finite, and cannot be double-booked                             | L4 `10` + L1 `reminder-plan`                               |
| Where two routing rules match, the last triggering option wins                    | L1 `answer-routing`                                        |
| Answer-based routing takes precedence over on-completion routing                  | L1 `answer-routing` + L3 `scheduled-actions-worker`         |
| Completing a questionnaire routes the candidate, public intake included           | L4 `10` + L3 `scheduled-actions-worker`                    |
| A routing target that no longer resolves moves nobody, and says why               | L4 `10` + L3 `scheduled-actions-worker`                    |

The L4 suite was mutation-checked rather than merely written: disabling the
status-transition trigger, dropping the producer trigger, replacing the claim
function with a naive `select … where status = 'pending'`, and dropping the
ledger's unique constraint each turn a distinct set of assertions red. A suite
that passes against a gutted implementation asserts nothing.

### L4 — Database (live now)

pgTAP. Migrations are the contract; these tests assert the contract holds.

Suites live in `supabase/tests/*.test.sql`. The extension is installed by
`supabase/migrations/0008_pgtap.sql` into the `extensions` schema — not `public`,
where it would add roughly a thousand functions to the PostgREST surface and add
a second entry to the security advisor's "extension in public" finding alongside
the inherited `citext`. The project's `search_path` is `"$user", public,
extensions`, so `plan()`, `ok()` and friends resolve unqualified.

#### Running it

```bash
cd frontend
npm run db:start               # once; the local stack, see development.md
npm run test:db:local          # every suite
npm run test:db:local -- 03    # only files whose name contains "03"
```

`npm run test:db` (without `:local`) runs the same files against whatever
database `frontend/.env` and `frontend/.env.local` point at, such as a hosted
development project.

#### Why not `supabase test db`

That command only drives the local stack, through the CLI's own pgTAP runner.
The suites were first written against a hosted development project, where it
cannot be used, and `supabase/tests/run.mjs` works against either, so the local
stack and a hosted project run the identical files through the identical
harness.

`supabase/tests/run.mjs` is the runner. It discovers `*.test.sql`, executes each
file, parses the TAP stream, and exits non-zero on any `not ok`, on a missing or
mismatched plan line, on a SQL error, or on a file that produced no tests at all.
That last case matters: a harness that reports success without executing anything
is worse than no harness.

It reaches the database two ways:

| Condition               | Mechanism                                                                                     | Used by                       |
| ----------------------- | --------------------------------------------------------------------------------------------- | ----------------------------- |
| `SUPABASE_DB_URL` set   | `psql`, direct connection                                                                     | CI and `test:db:local` (the local stack), or a hosted project |
| `SUPABASE_DB_URL` unset | `supabase db query --linked` — Management API, authenticated by your `supabase login` session | a linked hosted project, zero setup |

Both run the identical files. The Management API returns only the final result
set of a multi-statement request, which is why every suite ends in a single
`select * from runtests(...)` rather than a sequence of bare `select ok(...)`
statements — `runtests()` emits the whole TAP stream from one statement, so the
two paths produce byte-identical output.

Against a hosted project, `SUPABASE_DB_URL` must be the **session pooler on port
5432**, not the transaction pooler on 6543: pgTAP needs session-scoped temp tables
and explicit transactions. Set it in `frontend/.env.local`; the npm script loads
it. Full setup steps are in [development.md](development.md#optional-against-a-hosted-project). The local stack's URL is a direct connection and needs none of this.

#### Writing a suite

Every file follows the same shape, and the shape is load-bearing:

```sql
begin;

create schema if not exists tap;

create function tap.test_something() returns setof text language plpgsql as $fn$
begin
  return next ok(true, 'name the behaviour, not the function');
end;
$fn$;

select * from runtests('tap'::name, '^test_'::text);

rollback;
```

**These tests may execute against a real, shared development database**, not only
the throwaway local stack. The outer `rollback` and the savepoint `runtests()`
wraps each test function in are what keep that safe — a suite must leave no rows
behind. Prefer read-only catalogue
assertions (`col_type_is`, `col_is_unique`, `has_function`, `policies_are`);
where a test must write, seed its own fixtures with `gen_random_uuid()`-derived
slugs and emails so concurrent runs cannot collide on a unique index.

Because the `tap` schema is created and rolled back rather than committed, two
simultaneous runs against the same database can race on it. CI avoids that by
giving every job its own local stack; on a shared hosted project, don't run two
suites at once.

#### CI

The `test-db` job in `.github/workflows/ci.yml` runs on every push and pull
request. It installs a pinned, checksum-verified Supabase CLI, runs `npm run
db:start`, writes the stack's public local defaults to the job env with
`scripts/local-supabase-env.mjs`, runs `npm run test:db` and stops the stack.
`test-integration` does the same for L3. Neither reads a repository secret, so
both run on pull requests from forks. The runner fails on any `not ok`, missing
plan, SQL error or file that ran no tests, rather than reporting green while RLS,
the whole authorisation model, goes unverified.

#### Priorities, in order

1. **RLS policies** — ✅ `04_positions_public_visibility.test.sql`,
   `07_message_privacy.test.sql`, `08_inbound_threading.test.sql` and others.
   For each table, assert what `anon` can and cannot do. The
   `positions_public_read` policy once over-exposed unlisted roles; the fix in
   migration `0009` shipped with a test written first, failing before the
   migration and passing after it. Switch role with `set local role anon` inside the test
   function, capture the result into a variable, then `reset role` before
   asserting — pgTAP's own bookkeeping uses session temp tables that `anon`
   cannot write to.
2. **`submit_application`** — partly covered.
   ✅ `15_public_intake_resubmission.test.sql`: a resubmission with a known email
   changes nothing on the existing candidacy, and cannot redirect its routing.
   Still open: rejecting draft/closed/disabled positions and ignoring answers
   for questions outside the position's questionnaire.
3. **`snapshot_pipeline_to_position`** — ✅ `03_snapshot_pipeline_freeze.test.sql`.
   Copies every stage including success and terminal ones, replaces rather than
   duplicates on a re-snapshot, and refuses to run on a non-draft position.
4. **Constraints** — partially covered.
   ✅ `people.email` is `citext unique`, and a differently-cased duplicate is
   rejected while a differently-cased lookup still resolves the same Person
   (`01_people_identity.test.sql`).
   ✅ `unique (person_id, position_id)` on `applications`, with the same Person
   still able to hold a candidacy on another Position
   (`02_applications_unique_candidacy.test.sql`).
   ✅ the scheduled-send state machine on `messages` — a `scheduled` row must
   carry a `scheduled_for` and a non-scheduled row must not, so the worker can
   neither miss a due message nor send one twice (`07_message_privacy.test.sql`).
   Still open: the `slack_config` singleton check and cascade behaviour on delete.
5. **Inbound, threading and quarantine** — ✅ `08_inbound_threading.test.sql`.
   The webhook's idempotency is a _database_ guarantee, not a handler
   convention: the handler checks first, but check-then-act has a race in the
   middle, and the unique index on `messages.inbound_email_id` is what actually
   stops the duplicate row. Same for thread resolution — unique
   `(person_id, normalized_subject)` is what makes "select, else insert, else
   re-select" safe. Also asserts the partial index really is partial (any number
   of outbound rows may carry no `inbound_email_id`), that `rfc_message_id` is
   unique so threading stays deterministic, that deleting a thread takes its
   messages, and that `anon` gets nothing on either new table —
   `unmatched_inbound_emails` holds whole email bodies.
6. **Message privacy** — ✅ `07_message_privacy.test.sql`. `anon` gets nothing on
   `messages` or `message_templates` — no select, insert, update or delete — and
   the `message-attachments` bucket is private with no anon policy at all.
   Candidate correspondence is the most sensitive data in the system, and the
   anon key ships in the browser bundle.

### L5 — E2E (planned, not built)

**There is no end-to-end suite today:** no `@playwright/test` dependency, no
`playwright.config.ts`, no `frontend/tests/e2e/`. Journeys that cross the whole
system are checked by hand with [testing-checklist.md](testing-checklist.md).

When it is built: Playwright against a seeded staging build, with deliberately few
specs, because E2E is the slowest and most brittle layer. It should cover only
journeys that cross subsystem boundaries and would not fail at any lower layer.
The one that matters:

> apply → board → automated email → reply threads in inbox → move → hire

## Conventions

- **Colocate** unit and component tests next to the code (`foo.test.ts`).
  Cross-cutting and integration suites live in `frontend/tests/`.
- **Name the behaviour, not the function**: `"cancels pending actions when the
candidate leaves the stage"`, not `"test cancelAction"`.
- **Say so in a comment** when a test encodes a product rule — future
  readers need to know an assertion is a product decision, not an implementation
  detail.
- **No network in L1/L2.** `tests/setup.ts` seeds fake Supabase env vars so
  importing a client never reaches out.
- **Coverage is a signal, not a target.** No threshold gate. Layouts
  and the icon set are excluded from the report so the number stays honest.
