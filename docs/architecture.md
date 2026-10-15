# Architecture

How this codebase is organised and the conventions to follow when extending it.
Descriptive, not aspirational — where something is not yet true, it says so.

## Shape

```
frontend/          Next.js app — owns package.json, run npm from here
supabase/          Migrations, pgTAP tests and their runner
docs/              This file, testing, deployment
```

The two background workers (automation queue, orphan-upload clean-up) are Route
Handlers under `frontend/app/api/workers/`, called by `pg_cron` in the database.

There is **no separate backend service.** The `/api/*` surface is Next.js Route
Handlers in the same app, talking to Supabase server-side.

```
Browser ──► React Query hook ──► services/ (axios) ──► /api/* Route Handler
                                                              │
                                                              ▼
                                                     Supabase (server client)
                                                              │
                                                              ▼
                                                      Postgres + RLS
```

Public careers pages skip that chain: they are Server Components reading
Supabase directly with the anon client, relying on RLS
(`app/(public)/careers/_data.ts`).

## Two shells

| Shell    | Route group     | Layout                | Access          |
| -------- | --------------- | --------------------- | --------------- |
| Internal | `app/(app)/`    | Top nav + avatar menu | Authenticated   |
| Auth     | `app/(auth)/`   | Split layout          | Unauthenticated |
| Public   | `app/(public)/` | Lighter public header | Open            |

## Frontend layout

| Directory              | Holds                                                       | Rule                                     |
| ---------------------- | ----------------------------------------------------------- | ---------------------------------------- |
| `app/`                 | Routes, layouts, Route Handlers                             | Pages compose; they don't fetch directly |
| `components/atoms`     | Button, Input, Badge, Card…                                 | No domain knowledge                      |
| `components/molecules` | Small compositions                                          |                                          |
| `components/organisms` | Domain components (candidate card, top nav, video recorder) |                                          |
| `components/templates` | Page-level layout scaffolds                                 |                                          |
| `configurations/`      | Supabase clients, Zod-validated env                         | **Only** place `process.env` is read     |
| `hooks/`               | React Query hooks                                           | One per entity                           |
| `services/`            | Typed HTTP clients                                          | One per entity; wraps `HttpClient`       |
| `schemas/`             | Zod schemas                                                 | Shared by API handlers and forms         |
| `types/api.ts`         | Real DTOs                                                   | The single source of entity types        |
| `utilities/`           | Pure helpers                                                | Isomorphic, no I/O                       |
| `middlewares/`         | Session refresh + route gating                              | Invoked from `proxy.ts`                  |
| `providers/`           | React context (auth, query)                                 |                                          |
| `tests/`               | Setup + cross-cutting suites                                | Colocated tests live next to their code  |

## Conventions

**Environment.** Read only via `configurations/env-configuration.ts`, which
Zod-validates at import. Never `process.env` elsewhere. Validation throws at
startup, which means `npm run build` fails without the Supabase vars — that is
deliberate, and CI supplies placeholders.

**Auth is checked twice.** `middlewares/auth-middleware.ts` gates routes and
refreshes the session; every `/api/*` handler independently calls `requireUser()`.
Handlers must not trust the middleware alone. Requests to `/api/*` are exempted
from the login _redirect_ so a fetch receives a JSON 401 rather than an HTML page.

**Route Handler shape.** Every internal handler follows the same sequence:

```ts
const ctx = await requireUser();
if (ctx instanceof NextResponse) return ctx; // 401
const { supabase } = ctx;

const parsed = someSchema.safeParse(body); // 422 on failure
// … Supabase work …
return NextResponse.json({ entity: mapEntity(row) });
```

Helpers are in `app/api/_helpers.ts`; row→DTO mapping in `app/api/_mappers.ts`.

**Naming.** Database is `snake_case`; DTOs are `camelCase`. Mappers are the only
place the two meet — never leak a raw row past a mapper.

**Data fetching.** Components call hooks; hooks call services; services call
`HttpClient`. A component should never import `axios` or a Supabase client
directly. Exception: Server Components on the public surface, which read Supabase
directly under RLS.

## Database

The schema is the contract, and every change is a numbered migration in
`supabase/migrations/`. The migration comments are the documentation for the
database: read them before changing a table, trigger or policy.

**Rules that live in the database, not application code:**

- **Identity.** `people.email` is `citext unique` — one Person per email address,
  case-insensitive. `applications` is `unique (person_id, position_id)`.
- **Stage freeze.** `snapshot_pipeline_to_position` refuses to run unless
  the position is `draft`. Stage order cannot change once live.
- **Public intake.** `submit_application` is `SECURITY DEFINER` and re-verifies
  the position is open and published. Since `0049` only the service role may
  call it, so every application goes through `/api/apply` and its captcha and
  rate limits. `anon` has no direct write access to any table.

**RLS is the authorisation model.** There are no roles: every
authenticated user gets `using (true) with check (true)` on every internal table.
The security boundary is entirely `authenticated` versus `anon`.

**Public reads go through functions, not the table.** `anon` may select only
`open` + `listed` positions directly. Unlisted roles are off the table surface
entirely — RLS cannot distinguish a by-slug lookup from a table sweep, so
direct-link access lives in `public_position_by_slug`, a `SECURITY DEFINER`
lookup returning at most one row. `public_position_questions` serves the embedded
application form and omits `answer_routing`. Each returns an explicit column list
rather than `setof positions`, so adding a column cannot silently widen what is
public. **Residual risk, accepted:** anyone who guesses or already holds a slug
still resolves the role, and slugs can be probed one at a time. That is inherent
to a link-is-the-secret model; the mitigations are unguessable slugs and request
rate limiting, neither of which a policy can do. Covered by
`supabase/tests/04_positions_public_visibility.test.sql`.

**Files.** Uploads live in one private Cloudflare R2 bucket per environment,
reached only through `configurations/object-storage.ts`. Its three folders,
`resumes`, `videos` and `message-attachments`, are named after the Supabase
Storage buckets the app used before, so a stored path still means the same
file. Signed-out visitors have no direct access: `/api/public-uploads` checks
that the position is open (or the questionnaire link is live) and the rate
limit, picks the object path, and returns a short-lived signed upload URL with
the size and type limits signed into it. Internal reads go through signed
download URLs.

## Not yet built

Named here so nobody assumes otherwise:

- **Hosted questionnaire uploads do not become `documents` rows.** A file or
  video answered on `/q/[token]` is stored in the same bucket as an application
  upload and renders on the profile's Questionnaires tab, with a signed download
  link, because `resolveAnswerMedia` reads the answer's `storagePath`. It does
  not appear on the Documents tab, which lists `documents` rows and nothing
  else — those are written by `submit_application` alone. Deliberate: linking
  them would mean widening `submit_questionnaire_response`, and the file is
  already reachable.
- **No manual "send questionnaire" from a candidate's profile.** The board's
  action bar has a bulk send, and `sendQuestionnaireToCandidate` in
  `app/api/questionnaires/_send.ts` is a per-candidate function, so a profile
  control would be a button and a route rather than a mechanism. It is not in
  the approved profile design, so it is not built.
- **Quarantined inbound mail cannot be reassigned.** An email from an unknown
  address is stored and readable in the Inbox, but there is no "attach this to a
  candidate" action. Deliberately deferred — see the decision below.
- **No scheduled bulk send.** Both bulk sends —
  `POST /api/applications/bulk-email` and
  `POST /api/applications/bulk-questionnaire` — send immediately, although a
  single email can be scheduled. The queue could drain a scheduled bulk row
  (`0034`); what holds it back is that a bulk send is `n` separate `dispatchMessage` calls
  reported one by one through `buildBulkOutcome`, and a scheduled bulk send needs
  a decision about what a partial cancel means before it is worth building.
- **No undo on a bulk action.** The design shows an undo toast; the board shows
  the outcome report without it. Archive is confirmed before it runs, and a move is
  re-runnable by hand.

## Design decisions worth knowing

Code comments explain *why*, not *what*; clarity comes first from naming and
structure. A handful of decisions are genuinely non-obvious and cannot be
inferred from the code, so they are recorded here. **When you make another
decision of this kind, record it here; a short comment at the spot can point to
it.**

### `.select()` strings must be single unbroken literals

supabase-js infers the returned row shape by parsing the `.select()` string **at
the type level**. A concatenated string — `"id, title, " + "stages(id)"` — widens
to `string`, which collapses the result to `GenericStringError` and forces a cast
at every call site.

This is why `POSITION_DETAIL_SELECT`, `CANDIDATE_SELECT`, the questionnaire
`TEMPLATE_SELECT`s and the careers `DETAIL_SELECT` are written as one long
literal each, however unwieldy that looks. Reformatting one across `+` for
readability silently reintroduces 13 casts and destroys the type safety the
generic exists to provide. **Do not "tidy" these strings.**

### jsonb columns are normalized at the mapper border

Postgres `jsonb` columns arrive as `Json` — no shape is enforced by the database,
and none of `locations`, `options`, `hiring_team`, `application_form_config`,
`custom_attributes` or `application_form_answers` has a check constraint.

Before generated types, the mappers simply _declared_ these as pre-shaped arrays
and records. A malformed row would flow to the UI fully "typed" and fail at the
render site, far from the cause. They are now validated in `app/api/_mappers.ts`
(`normalizeLocations`, `normalizeOptions`, `normalizeHiringTeam`,
`normalizeFormConfig`, `normalizeStringMap`). **Any new jsonb column needs a
normalizer** — the mapper is the only place a raw row becomes a DTO, so it is the
only place this can be enforced.

### Hosted video links are re-parsed server-side, never trusted

`utilities/video-link.ts` accepts only an allowlist of providers (YouTube,
Vimeo, Loom, Google Drive), https only. `POST /api/apply` re-parses every
candidate-supplied URL through it and discards any client-supplied `embedUrl`.

Whatever this function returns becomes an `iframe src` on an internal reviewer's
screen. Accepting free-form URLs would let an applicant put an arbitrary page in
front of staff — a phishing surface. Adding a provider means one entry in
`PROVIDER_HOSTS` plus a branch in `parseVideoLink`; never loosen the allowlist.

**If a Content-Security-Policy is ever added** (there is none today —
`next.config.ts` sets no headers), `frame-src` must allow:
`https://www.youtube-nocookie.com https://player.vimeo.com https://www.loom.com https://drive.google.com`

### Video upload paths are validated by shape, not by existence

Files and recorded videos upload from the browser straight to object storage,
through a signed URL from `/api/public-uploads`, and the browser then sends the
resulting path with the submission. That path is client-supplied, so `/api/apply`
must not trust it: the route accepts a path only if `isApplicationStoragePath`
says it has exactly the shape the upload route produces, inside that position's
folder.

It deliberately does **not** check that the object exists. A
forged-but-well-formed path only yields a row whose signed URL resolves to
nothing, which the profile renders as "no video".

### The public intake may create a candidacy, and may never rewrite one

`people.email` is the identity key and an email address is not a
secret. `submit_application` resolved the Person by email — correctly — and then
treated a conflict on `(person_id, position_id)` as "this applicant is refreshing
their own submission", replacing `application_form_answers`, **deleting** the
embedded `questionnaire_responses` row and inserting a fresh `completed` one, and
appending `documents`.

That made one unauthenticated POST to `/api/apply`, from anyone who knew a
candidate's address and a published position id, enough to overwrite that
candidate's answers and destroy their questionnaire response, leaving a
normal-looking application and no audit trail. The identity resolution was never
the bug; treating "same email" as "same person, authenticated" was.

`0036` draws the line where the absence of authentication puts it. A submission
that conflicts with an existing candidacy writes **nothing but `updated_at`** —
not the answers, not the questionnaire, not the documents. The original intent of
the conflict arm survives exactly: an applicant pressing Submit twice still gets
the success payload and the confirmation screen rather than an error.

Three consequences worth knowing.

**The reply is deliberately identical either way.** "You have already applied to
this role" would be friendlier and would also be an email-enumeration oracle on
an anonymous endpoint. The two cases are indistinguishable from outside, so a
second submission is invisible to the sender and to the recruiter alike.

**`updated_at` is the one thing that moves**, and that is on purpose: with
everything else a no-op it is the only trace that a second submission arrived,
and `applications_updated_at` would stamp it on any touch of the row regardless.
It is what the board's "last activity" filter reads, so an anonymous caller can nudge that
one field. That is the residue, stated rather than hidden.

**A duplicate submission's uploads become orphans.** `/api/apply` writes to
Storage before it calls the function, so those objects get no `documents` row —
which is already a handled state, reported by `orphaned_application_uploads`
(`0011`) once the grace period passes.

What is deliberately **not** changed is the `people` backfill. An established
Person is still never renamed and never has a value overwritten, but a column
that is still blank — `phone`, `last_name` — can be filled in by a public
submission. That is left alone because the same write is reachable by applying to
any other open position with that address, which is ordinary public behaviour and
not fixable without authenticating the applicant. It is a real residue and it is
named here rather than quietly closed halfway.

The escalation this also closes is the reason it is high severity rather than
merely untidy. The replacement response was inserted `completed`, which fires
`questionnaire_responses_answer_routing` (`0022`). On any position whose embedded
questionnaire carries `answer_routing`, a visitor could choose the answer that
routes at a terminal stage and have this system move — and reject — a named
candidate. No position has such a rule today, so it was latent; it is now
structurally impossible. `questionnaire_responses_application_embedded_idx` makes
"one embedded response per application" a property of the table rather than of
one careful caller, which is also what closes the concurrent case.

### `/api/*` is exempt from the middleware login redirect

`middlewares/auth-middleware.ts` lets `/api/*` through without redirecting.
Route Handlers enforce their own auth and must always answer with JSON. If the
middleware redirected them, a browser `fetch` would receive the `/login` page as
HTTP 200 HTML and the client would parse `undefined`. Instead `requireUser()`
replies 401 and the axios interceptor bounces to `/login`.

### Empty-string env vars must fall back, so `||` not `??`

`NEXT_PUBLIC_API_BASE_URL` is commonly _set but blank_. `??` only substitutes on
`undefined`, so a blank value would slip through and every request would drop the
`/api` prefix, hitting the HTML page route instead. Both `services/http-client.ts`
and `configurations/env-configuration.ts` coerce blank to the default — the Zod
schema does it in a `.transform`, because `.default()` alone has the same gap.

### `setAll` is try/catch-wrapped in the server client

In a plain Server Component Next's cookie store is read-only, so writing throws.
Session refresh there is a no-op; the auth middleware handles it on every
request. The catch is load-bearing, not defensive noise.

### The position edit form seeds from the query without an effect

`EditPositionScreen` holds `{ positionId, values }` and renders
`form.positionId === position.id ? form.values : positionFormValues(position)`.
There is deliberately **no** `useEffect` copying the fetched position into state.

Two reasons. React's `set-state-in-effect` lint rule (enabled via
`eslint-config-next`) rejects it outright, and the effect would also clobber
in-progress edits every time React Query refetched the position — which
`useUpdatePosition` triggers on every successful save. Keying the held state by
position id gives the same "hydrate once, survive refetch, reset when the id
changes" behaviour with no synchronisation step. Don't reintroduce the effect.

### The pipeline control is withheld, not merely error-handled

`PATCH /api/positions/[id]` answers **409** when a non-draft position's pipeline
is reassigned (enforced in `snapshot_pipeline_to_position`). The edit
screen never lets that request be built: `isPipelineEditable` gates the control,
and `assignedPipelineId` is destructured out of the patch entirely when the
position has left draft. The 409 branch in `saveErrorMessage` is a backstop for a
concurrent status change, not the primary path — if you find yourself relying on
it, the UI has drifted.

### Server-only env is validated lazily; public env stays eager

`configurations/env-configuration.ts` now holds two schemas. The public one is
parsed at import and throws, exactly as before. The server one — `RESEND_API_KEY`,
`EMAIL_RELAY_ADDRESS` and the other secrets — is parsed inside `serverEnv()`,
memoised on first call. The company identity (`COMPANY_NAME`,
`COMPANY_WEBSITE_URL`, `COMPANY_LOGO_URL`, `COMPANY_CAREERS_URL`) is a third,
equally lazy schema behind `companyEnv()`, so the careers pages can read it
without needing the mail credentials. None of them defaults to a real company:
blank stays blank, and a missing `EMAIL_RELAY_ADDRESS` refuses the send (503).

It cannot be eager. That module is imported by `supabase-browser-configuration`,
so it ends up in the client bundle, and Next inlines only `NEXT_PUBLIC_*` there.
An eager `RESEND_API_KEY: z.string().min(1)` would see `undefined` in every
browser and throw on page load. Lazy also keeps `npm run build` working without a
mail credential, which is what CI has.

`serverEnv()` and `companyEnv()` must only ever be called on the server (a Route
Handler or a server component). Calling one from a client component would not
leak the key — Next replaces the reference with `undefined` client-side — but it
would throw at render.

### The send path sends first, then records

`dispatchMessage` in `app/api/messages/_send.ts` calls the relay and only then
inserts the `messages` row. The reverse order is the usual instinct and it is
wrong here: a row written before the send would have to be reconciled afterwards,
and the automation worker — a second writer scanning for pending rows — would
find it and send the same email again. **An email that has gone out cannot be
recalled** (which is also why moving a candidate never recalls an action that has
already run), so the design refuses to risk sending twice and accepts
the much smaller risk of a send that is not recorded. That case answers 500 with
the relay id in the message, which is recoverable by hand.

A relay rejection is not silent: it inserts a row with `status = 'failed'` and a
`failure_reason`, then answers 502.

### Scheduled send is persisted, not handed to the provider

Resend can schedule natively (`scheduledAt`). This app deliberately does not use
it. A scheduled message is a row with `status = 'scheduled'` and `scheduled_for`,
and nothing more happens until the automation worker picks it up. Two reasons:
cancel-on-move has to be able to cancel a pending send, and a message sitting in Resend's
queue is not ours to cancel reliably; and every scheduled send — manual, stage
action, reminder — should come due through one mechanism rather than two.

Migration `0015` makes that a database invariant rather than a convention: a
`scheduled` row must carry a `scheduled_for`, and a non-scheduled row must not.
The partial index `messages_due_outbound_idx` is exactly the worker's pickup
predicate.

### Email bodies are a small, defined markup subset — not HTML

`utilities/rich-text.ts` renders the authored body. Authors write plain text plus
`**bold**`, `*italic*`, `__underline__`, `## heading`, `- bullet` and
`[label](url)`. Everything is HTML-escaped first, so no author, template or merge
value can inject markup, and link URLs go through `safeLinkUrl`, an allowlist of
`http`/`https`/`mailto` — the same trust-boundary reasoning as `video-link.ts`.
An unsafe URL keeps its label and loses its anchor.

This is why there is no contenteditable editor: a real rich-text surface would
have meant a new dependency and an HTML sanitiser, and the toolbar in the design
would otherwise have had to stay decorative. `applyRichTextMark` wires the
existing six buttons to the subset above, so nothing on that toolbar is a prop.

### Merge variables resolve before rendering, and never leave a raw token

`resolveMergeVariables` runs over the plain source, then `richTextToHtml` escapes
the result. That order matters: resolving into already-rendered HTML would let a
merge value land inside an `href` without passing `safeLinkUrl`.

**Every** `{{…}}` is consumed, including malformed and unknown ones — an unknown
group, a one-segment token, `{{}}`. A candidate must never receive a literal
`{{candidate.first_name}}`. Missing values resolve to `""`, except
`candidate.first_name` and `candidate.full_name`, which fall back to `there` so a
greeting still reads. An author can override with `{{group.field|fallback}}`.

### Email attachments live in Storage, not in the request

`POST /api/messages` takes multipart, uploads each file to the private
`message-attachments` folder in object storage, and stores `{path, filename, mimeType, size}` in
`messages.attachments`. Whoever sends downloads the bytes at send time.

The bytes have to be somewhere durable because a scheduled message is sent later,
by the worker, long after the request body is gone. Only signed-in staff can
write there.

### The RFC Message-ID is fetched and stored at send time

`messages.relay_message_id` holds Resend's internal id (`a3580f68-…`). That is
**not** the RFC 5322 Message-ID a reply quotes in `In-Reply-To`, which looks like
`<0106019f…@ap-northeast-1.amazonses.com>` and is only available from
`resend.emails.get(id).message_id`. Threading cannot join on `relay_message_id`,
so `messages.rfc_message_id` exists alongside it (migration `0017`).

The choice was: fetch it once on the send path, or resolve id→message_id lazily
on every inbound reply. **Send path wins.** That code is already doing network
I/O and already blocking on the relay, so one more call costs nothing a user can
feel; the reply path is a webhook with a retry budget, where an extra
round trip per candidate reference is real money and real latency. It also means
threading is a plain indexed lookup rather than an N-call fan-out, and it keeps
the expensive work on the side of the system we control.

The call is wrapped in try/catch and **never fails a send.** If Resend does not
return a Message-ID the row stores `null`, and threading for that message
degrades to the subject fallback below. A send that went out is not thrown away
over a missing header — the same reasoning as "the send path sends first, then
records".

Message-IDs are stored **without angle brackets and lower-cased**, because a
reply's header always carries the brackets and the domain half is
case-insensitive. Both sides normalize through `normalizeMessageId` so the two
forms cannot miss each other.

### Threads are person-level rows keyed on the normalized subject

`message_threads` is a real table (`0017`); `messages.thread_id` was a bare text
column nothing ever wrote. A thread belongs to a **Person** — one
candidate who applies to three roles has one correspondence history. Position
context is kept twice over: each message carries its own `application_id`, and
the thread carries the most recent one so the per-position Inbox can scope.

`normalized_subject` — reply prefixes stripped, whitespace collapsed,
lower-cased, `(no subject)` when empty — is **unique per person**. That
constraint is doing real work: it makes `ensureThread`'s select-else-insert
idempotent, so two replies arriving at once cannot fork one conversation into
two threads. The accepted consequence is that two same-subject conversations
with one person merge. That follows from threads being person-level, and it is
the better failure: a merged thread is legible, a silently forked one is not.

### The sender address outranks the threading headers

Inbound threading tries `In-Reply-To`, then `References` nearest-ancestor-first,
then the subject. Headers are attacker-controlled — anyone who has ever received
one of our emails knows a real Message-ID and can quote it.

So `matchThreadByReferences` takes the Person resolved from the **From address**
as the authority. A referenced message belonging to a different Person is
skipped, not followed; scanning continues in case a later reference belongs to
the actual sender, and if none does the reply opens its own thread. A forged
header can therefore make a reply _fail_ to thread, which is visible and
harmless. It can never inject a message into another candidate's history, which
would be neither.

When the headers name nothing we sent — a client that strips them, a candidate
composing a fresh email — the subject fallback applies. When that finds nothing
either, a new thread opens. **No inbound message is ever discarded for want of a
match.**

### Inbound mail that matches no Person is quarantined, not dropped

A reply can arrive from an address that is not in `people`: a candidate writing
from a second mailbox, a colleague they CC'd, or spam to a published relay
address. Three options were on the table and two are wrong.

_Drop it_ loses candidate mail silently, which is the worst outcome a mail
system can have. _Auto-create a Person_ fills the candidate database from the
spam feed, and manually adding candidates is deliberately not a feature anyway
(see "Deliberately absent"). So it is
**stored whole** — headers, both bodies, attachment metadata — in
`unmatched_inbound_emails`, and surfaced in the Inbox behind an amber
"N unmatched emails" control that only appears when there are any.

It does not go in `messages` because `messages.person_id` is `not null`, and
relaxing that would put unattributed rows in the middle of every candidate
query, every thread and every export. A separate table keeps the main path
honest.

None of this was specified up front, beyond replies being matched to the
correct Person, so it is a design decision, and the deliberate gap is that
there is no "attach this to a candidate" action yet. Reading it is enough to
stop mail being lost; reassigning it is a feature, and an unrequested one.

### The inbound webhook is public, signature-verified and idempotent

`POST /api/webhooks/resend/inbound` takes no session — the relay has none — so
`middlewares/auth-middleware.ts` lists `/api/webhooks/` explicitly in
`UNAUTHENTICATED_API_PREFIXES` and returns before touching Supabase at all. That
is a declaration, not an accident: the prefix is asserted in a test so the
endpoint cannot quietly become gated, or quietly widen.

The signature is the whole authentication story. Resend signs with Svix /
Standard Webhooks headers; `utilities/webhook-signature.ts` recomputes
`HMAC-SHA256(secret, "id.timestamp.body")` over the **raw body text** and
compares in constant time, accepting any of several offered signatures so key
rotation works. Deliveries older or newer than five minutes are refused even
when the signature is genuine, which is what stops a captured request being
replayed. With no `RESEND_WEBHOOK_SECRET` configured it **fails closed** — 503
to everything, never open.

**The size cap is counted off the stream, before the body exists as a string.**
It used to be `await request.text()` followed by `payload.length > 1_000_000`,
which bounds what gets parsed and not what gets held — the whole body was already
in memory by the time the cap was consulted, so the cap protected nothing it was
there to protect. `readBoundedRequestText` in `app/api/_helpers.ts` reads chunks
from `request.body`, adds up `byteLength`, and cancels the reader the moment the
total passes the limit.

The bytes are then joined and decoded **once**, which is what keeps the signature
honest: `verifyWebhookSignature` still hashes the exact body Resend sent, byte for
byte, because a UTF-8 decode of the concatenated chunks is the same string
`request.text()` would have produced. That is asserted rather than assumed — the
L3 suite delivers a 900 KB signed payload, which necessarily arrives in several
chunks, and requires it to verify and be answered `200`. If the reassembly were
wrong the HMAC would not match and that test would 401.

Counting bytes rather than UTF-16 code units also makes the cap slightly
stricter than it was, which is the correct direction for a limit whose job is to
bound memory.

Verification happens **before** anything else, and the idempotency check happens
before the second Resend call. The `email.received` payload is a notification
only — no headers, no body — so every new message costs one
`emails.receiving.get`, and a retry that has already been processed must not pay
for it. `messages.inbound_email_id` and `unmatched_inbound_emails.relay_email_id`
are both unique, so the check-then-act race is closed by the database rather
than by the handler's care: a duplicate insert raises `23505` and is answered
`200 duplicate`. Anything genuinely unexpected answers `500` so Resend retries;
an event type we do not handle is answered `200` so it does not.

### The webhook uses the service-role key, not an anon-callable function

It writes to `messages`, `message_threads`, `unmatched_inbound_emails` and
object storage with no user session, and RLS gives `anon` nothing on any of them. The
alternative — a `SECURITY DEFINER` function granted to `anon`, the pattern
`submit_application` uses — was rejected: the anon key ships in the browser
bundle, so that function would let anyone on the internet forge inbound
candidate mail.

`configurations/supabase-service-configuration.ts` is the only module that reads
`SUPABASE_SERVICE_ROLE_KEY`. Its callers are the Route Handlers that have no user
session: the webhook, both workers, the public intake routes (`/api/apply`,
`/api/questionnaire-submissions`, `/api/public-uploads`, each behind its captcha
and rate limit) and adding a team member. Missing key means 503, same as a
missing signing secret.

### An inbound body is stored as plain text, never as the candidate's HTML

`emails.receiving.get` returns both `html` and `text`. Only the text form is
stored (falling back to `htmlToPlainText` when the sender's client sent no text
part), and the Inbox renders every bubble as `whitespace-pre-wrap` text.

Rendering candidate-supplied HTML on an internal reviewer's screen is the same
trust boundary as `video-link.ts` and the rich-text link allowlist, and the same
answer applies: the alternative is an HTML sanitiser and a new dependency, for a
design whose message bubbles are plain text anyway. `htmlToPlainText` strips
`<script>`, `<style>` and comment blocks before it strips tags, so nothing
survives even as visible text. Outbound bodies — our own escaped markup from
`richTextToHtml` — go through the same function on the way to the screen, so one
code path renders both directions.

Attachments are the exception and are stored as bytes, in the same
`message-attachments` folder as outbound ones under an `inbound/` prefix. A file
that cannot be stored does not lose the message: the row is written anyway and
`failure_reason` names the file.

### Unread is a thread-level flag, and comes from the design

The only other read state in the product is `seen`/`unseen` on an
**Application**. The approved Inbox design has an unread dot and an Unread
filter, so it is built.

It is deliberately not per-user: the app has one shared access level and no
roles, so per-user read state would model a distinction the product does not
make. A thread is unread when `last_inbound_at > read_at`, or when an inbound
message exists and the thread has never been opened. Opening it in the Inbox
marks it read once, guarded by a ref rather than an effect that writes state.

### The Inbox reply goes through `POST /api/messages`, not a second sender

The reply box sends the same multipart request the Compose screen does, with a
`threadId` added. `dispatchMessage` then skips thread resolution, looks up the
thread's ten most recent Message-IDs and sets `In-Reply-To` and `References` on
the outbound email so the candidate's own client threads it too.

There is exactly one send path for a reason: it is where merge resolution, the
link allowlist, header-injection defence, attachment download, the failure row
and the send-then-record ordering all live. A second sender would have to
reimplement every one of them, and would drift.

### A reminder and a routing decision are queue rows, not a second engine

Reminders and answer routing added no scheduler. `scheduled_actions` grew a
`kind` (`stage_action | reminder | answer_routing`, migration `0022`) and two
payload columns, and both behaviours became rows in the queue stage actions
already used.

They inherit everything that made that queue defensible, unchanged: claiming with
`for update skip locked`, so overlapping workers cannot double-send; the status
machine, so nothing settles without a terminal state; the `failed`/`skipped`
reason columns, so nothing disappears quietly. **Cancel-on-move comes free** — a
reminder carries the `origin_stage_id` of the stage whose action sent the
questionnaire, so the existing cancel-on-move canceller is also the reminders'
leave-the-stage stop condition, with no new code.

### How a reminder chain is guaranteed to terminate

This is the failure that matters most in this subsystem: an unbounded reminder
loop emails a candidate forever. Four things stop it, and only the first is
load-bearing.

1. **There is no chain.** A reminder run is written once, as a single INSERT of a
   finite list, by `schedule_questionnaire_reminders`. **Nothing anywhere
   schedules a reminder from a reminder** — there is no recursion to run away,
   only a fixed set of rows created at the moment the questionnaire is sent.
   `schedule_questionnaire_reminders` has exactly one caller, in the worker's
   questionnaire-send path.
2. **The set is capped twice.** `reminder_number between 1 and 10` is a check
   constraint, and the function itself `limit 10`s whatever the caller passed.
   `reminderSchedule` in `utilities/reminder-plan.ts` also clamps `maxCount` to
   ten, but the database does not trust it.
3. **The slots are unique.** `scheduled_actions_reminder_slot_idx` is unique on
   (response, reminder_number) where `kind = 'reminder'`. A worker that crashed
   between sending and settling, a retry, or two workers at once cannot
   double-book reminder 2 — the second insert is a no-op, not a second email.
4. **Every stop condition cancels the remainder in the database.** Completion and
   a manual stop are triggers on `questionnaire_responses`; leaving the stage is
   the existing cancel-on-move canceller; the maximum is (2) and (3).

Each due reminder re-checking the stop conditions before it sends is then a
_fifth_ line, in `planScheduledAction`, and it is not redundant: a row a worker
has already claimed cannot be cancelled by any trigger (`claimed → cancelled` is
absent from the state machine on purpose), so the fire-time re-check is the only
thing protecting an in-flight reminder. For a reminder the re-check reports
completion **before** the stage move, because completing the questionnaire is
usually what caused the move — the cause, not the symptom.

The interval arithmetic is a pure function taking the send instant as a
parameter, next to `scheduled-action-plan.ts`, so "after 2 days, then after 4
days, up to 3 times" is a unit test rather than a two-week wait. Intervals are
**gaps** — the first from the send, each one after from the previous reminder —
and the last gap repeats if the list is shorter than the count. The stage-actions
editor renders the resulting days back to the user from the same function, so
there is no second implementation to drift.

### Answer routing: the producer is in the database, the decision is not

Completing a questionnaire enqueues an `answer_routing` row
(`questionnaire_responses_answer_routing`, an AFTER trigger). Deciding _where_
the candidate goes is `utilities/answer-routing.ts`, a pure function the worker
calls. The split is deliberate and each half is where it is for a different
reason.

The **producer** must be in the database because a questionnaire is completed
inside `SECURITY DEFINER` SQL — `submit_application` for one embedded in the
application form, `submit_questionnaire_response` for a hosted one — and the
database is the one place every completion passes through. A producer in the API
layer would be a step every caller had to remember, and a caller that forgot
would silently route nobody. This is the same argument as the stage-automation
producer trigger.

The **decision** must be in the queue-consuming worker because an unresolvable
target has to be recorded with a reason, and a settled queue row is the only
durable, inspectable place this system has to record one. A trigger that finds a
severed template link can only do nothing, silently.

Where two rules match, the last triggering option wins, evaluated in question
`sort_order`, then in the order the rules are stored on each question. Answer
routing beats on-completion routing, and that is a single branch: an answer match returns before
the on-completion target is considered. Both are unit-tested directly, and both
are asserted again end to end through the worker.

### What happens when a routing target no longer resolves

`answer_routing` keys on `pipeline_template_stage_id`, because
questionnaires are global templates and stages are per-position.
`position_stage_for_template_stage` resolves it at fire time and returns NULL
when `position_stages.source_template_stage_id` has been severed — which
`on delete set null` does permanently the moment a template stage is deleted.

A NULL resolution **leaves the candidate exactly where they are** and settles the
queue row `skipped`, with the reason "The stage this answer routes to is not on
this position, so the candidate was left where they are". There is no nearest
stage, no first stage, no next stage, anywhere in this engine. A silent wrong
move in an ATS is worse than no move, and a routing rule that quietly evaporates
is worse than either — which is why `enqueue_answer_routing` deliberately still
queues a row when the _only_ configured rule is an on-completion target that no
longer resolves. Something has to be there to carry the reason.

### The on-completion target is frozen when the response is created

`questionnaire_responses.on_completion_move_to_stage_id` is filled by a BEFORE
INSERT trigger, resolving the template's `on_completion_template_stage_id`
through the candidate's own position. Editing the template afterwards does not
redirect a questionnaire that is already with a candidate.

Answer routing cannot be frozen the same way — the answers do not exist until
completion — so it is resolved at fire time. That asymmetry is intentional and
asserted.

### The questionnaire link is a hashed, expiring, single-use capability

Built in migration `0025`. A hosted questionnaire link is
`<origin>/q/<token>` where the token is 32 cryptographically random bytes,
base64url — 256 bits, generated by `utilities/questionnaire-token.ts`. It is not
derived from any id, so it cannot be computed from anything an attacker already
holds, and the space is far too large to sweep.

`questionnaire_responses` stores `sha256(token)` and never the token itself. The
raw value exists in exactly one place: the link in the candidate's email.

**That claim was false until `0036`, and the correction is below** —
`app/api/questionnaires/_send.ts` passed the invitation, link and all, as the
body template to `sendTemplatedEmail`, which persists the rendered body to
`messages.body`. A working token was therefore sitting in an ordinary internal
table. See "The invitation is sent with the link and recorded without it".

**The verifiers take the raw token, and hash it in SQL.** This is the part worth
understanding, because the obvious design is wrong. If the app hashed the token
and looked the response up _by digest_, the stored digest would itself become the
credential — anyone who could read the table could pass what they read to the
same anon-callable function and be let in, which is exactly what hashing was
supposed to prevent. So `public_questionnaire_token_state`,
`public_questionnaire_by_token`, `public_questionnaire_questions_by_token` and
`submit_questionnaire_response` all accept the token and call
`questionnaire_token_hash` themselves. **There is deliberately no second SHA-256
implementation in TypeScript**; a known-answer vector pins the SQL one in
`11_questionnaire_tokens.test.sql` so it cannot drift and silently invalidate
every link already in a candidate's inbox.

None of the anon-facing functions takes a `p_now`. A caller who could supply the
current time could supply a time before the expiry, so they read the server clock
and nothing else. pgTAP tests expiry by backdating the stored column instead.

**Thirty days.** Long enough that a candidate on holiday is not locked out and a
reminder run (gaps of two to four days, at most ten of them) still lands inside
the window; short enough that a link sitting in an archived mailbox is not a
standing credential. The number is `QUESTIONNAIRE_TOKEN_TTL_DAYS`, and the
arithmetic takes the issue instant as a parameter so it is a unit test rather
than a month's wait.

**Completion kills the link twice.** `submit_questionnaire_response` sets the
status to `completed` — which every resolver requires to be `pending` — _and_
pulls `access_token_expires_at` back to now. Either alone would do; both together
mean a leaked link cannot be replayed to overwrite submitted answers even if a
later migration relaxes one of them.

**What a valid token reaches, and nothing more:** the questionnaire's name, the
position title, the position id (the video and file controls upload under
`applications/<position_id>/`, and the submit path re-validates the returned path
against it), and the questions. `answer_routing` is absent from the question
resolver's return type, exactly as it is absent from `public_position_questions`
— a candidate must never be able to read which of their answers moves them where.
No other response, no candidate record, no position list.

### Re-issuing a link invalidates the previous one

The token lives on the response row, so there is one live link per questionnaire.
The worker cannot recover a raw token it hashed, so **every reminder mints a fresh
one and the older link stops working.**

That is a real cost and it was taken deliberately. The alternative — a child
table of concurrently valid tokens — keeps old emails working, but the design is
one hashed token on the response, and rotation has a genuine security benefit: a link
leaked from an old email dies as soon as the next reminder goes out. The cost is
paid in copy rather than in silence: the expired-link page says a newer email
replaces the link in an older one, and tells the candidate to open the most
recent message or reply for a fresh link.

### The invitation is sent with the link and recorded without it

`0025` claimed the raw token exists in exactly one place, the link in the
candidate's email. It did not. `sendTemplatedEmail` composes a body and
`dispatchMessage` stores that same rendered HTML in `messages.body`, so every
questionnaire invitation and every reminder wrote a **working token** into an
ordinary internal table — readable by every signed-in user under the shared
access level, and present in every backup and every export. Lifting one, hashing
it and answering the questionnaire as the candidate needed no privilege the
product does not already hand out.

The fix is one field, not a second sender. `DispatchInput` gained
`recordedBodyTemplate`, composed through the same `composeEmail` with the same
merge context, and it is what goes into `messages.body`; `bodyTemplate` is still
what goes to the relay. `deliverToRelay` is untouched, so there is still exactly
one caller of `getEmailTransport().send`, and "bulk recipients do not see each
other" is still a property of one function.

`utilities/reminder-message.ts` therefore returns `{sent, recorded}` rather than
a string. The recorded half keeps the whole email and swaps the link for one
sentence — a single-use link was emailed, and the date it expires — which is what
a recruiter reading the thread actually needs to know. A reminder that uses a
custom `message_templates` body has no link in it to begin with and passes no
recorded body at all.

**A redacted body and a scheduled send are refused together.** A scheduled
message is not a record of a send, it _is_ the send: the worker delivers
`messages.body` verbatim, so storing a redacted body would email the candidate
the redaction. `dispatchMessage` answers 422 rather than allowing the
combination. Nothing reaches that branch today — `sendTemplatedEmail` always
sends immediately — and that is exactly why it is a guard rather than a comment.

The expiry date is formatted `en-GB` in **UTC**, like every other date this
system writes down (see the reporting month), so a stored body does not read
differently depending on where the server was when it was written.

The cost, stated plainly: the thread no longer shows the exact bytes that were
sent. A recruiter cannot re-open a candidate's link from the app — which is the
point — and re-sending is the repair, exactly as it already is when a candidate
says they never got the email.

### Every anonymous POST is bounded, one request at a time

`POST /api/apply` and `POST /api/questionnaire-submissions` are the two endpoints
that take a body from a stranger. Neither schema bounded anything: names, email,
phone and every `formAnswers` value were unbounded strings, and
`questionnaireTextAnswers`, `uploads` and `videoAnswers` were unbounded arrays —
`uploads` being an array of files up to 15 MB each. One request could put
megabytes into `applications.application_form_answers` for free.

Both schemas now carry `.max()` on every string and every array, with the shared
answer shapes in `schemas/candidate-answer-schema.ts` so the apply form and the
hosted questionnaire cannot drift apart. The limits are chosen so that a real
applicant cannot reach them: 100 characters of first or last name, 254 of email
(the RFC 5321 maximum), 40 of phone, 5 000 per application-form answer and at
most 50 of them, 10 000 per questionnaire answer and at most 200 of them, 100
choices of 500 characters on a multiple-choice answer, and 20 uploads and 20
video answers per request.

**These limits stop one request being enormous, not a script being
persistent.** That is a separate layer: the per-IP and per-address rate limits
in migration `0048` and the Cloudflare Turnstile captcha, both checked in the
server routes, with `0049` closing the direct routes around them.
[self-hosting.md](self-hosting.md#9-spam-protection-cloudflare-turnstile)
covers both.

### The hosted questionnaire submits through a Route Handler, not straight to the RPC

`POST /api/questionnaire-submissions` is unauthenticated in the same way
`POST /api/apply` is — no `requireUser()`, and the middleware lets `/api/*`
through without redirecting. It exists rather than the page calling
`submit_questionnaire_response` from the browser because the captcha and rate
limit are checked there, the file bytes have to be uploaded server-side, and the
video path has to be re-parsed through `parseVideoLink` and re-validated against
the position — the same trust boundary `/api/apply` already defends. Since `0049`
the function is callable only by the service role, so the route is the only way
in.

**The client is never given a response id, and never sends one.** It sends the
token; the route resolves the position from the token; the RPC resolves the
response from the token again, from scratch. There is no identifier in the
request that could be swapped for somebody else's.

The route re-uses `utilities/candidate-uploads.ts`, which is where
`applicationStoragePath` and `isApplicationStoragePath` now live — one copy,
shared by the apply route, the submissions route and `VideoAnswerField`, rather
than the three that had drifted into existence.

### The hosted page saves once; it does not autosave

The approved design shows a "Progress saved" chip. It is not built and the chip
is gone, because a partial save would need either a second write path into a
half-completed response or a draft store, and neither exists. The page
says "Answer everything, then submit — this link works once", which is what
actually happens. A control that lies about what it did is treated as a bug
throughout this codebase; a reassuring label that saves nothing is the same fault.

### There is one questionnaire sender, and the worker is no longer it

The first version put "mint a token, email the link, queue the reminder run"
inside the worker's `_run.ts`, because a stage action was the only thing that
could send. The board's bulk send adds a second caller — a Route Handler, with a
signed-in user — and copying that routine
would have meant two places where a token is issued and two places that could
forget to schedule reminders.

So it moved out whole, into `app/api/questionnaires/_send.ts`.
`sendQuestionnaireToCandidate` resolve-or-creates the response, issues the token,
sends the invitation and queues the reminders; the worker and
`POST /api/applications/bulk-questionnaire` both call it and differ only in a
`QuestionnaireSendKey` (`stage_sent` with a stage action, or `manual_sent` with the
stage the candidate was in) and in who the sender is. **Every property of the
original routine is inherited rather than re-implemented**: one live token per response, the
delete-the-row-if-the-link-could-not-be-issued cleanup, the thirty-day expiry, the
send-then-record ordering underneath.

The same de-duplication happened one layer down. `sendTemplatedEmail` in
`app/api/messages/_send.ts` is now the single "resolve the target, name the
sender, dispatch with no CC and no BCC" step, shared by the worker, the bulk email
route and the questionnaire sender. "Bulk recipients do not see each other" is
therefore a property of one function rather than a rule three call sites remember:
`cc: []` and `bcc: []` are written once.

### What a second bulk send to the same candidate does

Neither a duplicate nor a silent no-op, and the choice is enforced in the database
rather than in the route.

`questionnaire_responses_manual_pending_idx` (migration `0033`) is unique on
(application, questionnaire) **where the context is `manual_sent` and the status is
`pending`**. So:

- **A candidate who already has this questionnaire open** keeps the same response
  and gets a **fresh link**, which invalidates the older one — the identical
  behaviour a reminder already has, for the identical reason (the token cannot be
  recovered once hashed). Re-sending is the natural repair for "I never got the
  email", and creating a second response would put two half-finished
  questionnaires of the same kind on one profile and start a second reminder run.
  Re-scheduling is a no-op: `scheduled_actions_reminder_slot_idx` refuses the
  duplicate rows.
- **A candidate who has already completed it** is **skipped, by name**, with the
  reason "They have already completed this questionnaire, so it was not sent
  again". Silently re-asking would be a surprising thing for a bulk action to do
  to somebody who has already done the work, and silently succeeding without
  sending would be a lie. It lands in `failures`, which is the per-candidate
  channel the bulk move already established — so the board reports it, keeps that
  candidate selected, and the rest of the batch goes through.

The predicate is deliberately on `pending` and not on the context alone, so
history is never blocked: asking the same candidate again after they have answered
writes a genuinely new response, and both are kept.

### A manually sent questionnaire carries its own origin stage and schedule

A stage-sent response reads both from its `stage_actions` row: the stage that sent
it (which is what makes cancel-on-move apply) and the reminder block. A manual send
has no stage action, so migration `0033` puts both on the response —
`origin_stage_id` and `reminder_config` — and
`schedule_questionnaire_reminders` falls back to them.

The origin is **the stage the candidate was in at the moment of the send**, passed
in by the caller, never `applications.current_stage_id` read at scheduling time. A
candidate who moved on between the send and the scheduling call must not have
their reminders silently re-anchored to the new stage.

Everything else is untouched, and that is the point: the rows are still
`scheduled_actions (kind = 'reminder')`, still capped by the slot index, still
cancelled by all four of the reminder stop conditions — including the existing
cancel-on-move canceller, which now applies to a manual send for free.
`planScheduledAction` re-checks the reminder number against the schedule **stored
on the response**, not against whatever the default has become since, so a
reminder due in six days is judged by the rules that were in force when it was
created.

A candidate in no stage therefore gets the questionnaire and **no reminders**:
there would be no origin to cancel against, and a chase that no stage move can
stop is one this engine will not start. The send still succeeds and is reported as
sent.

The schedule itself is `DEFAULT_REMINDER` from `utilities/stage-action-form.ts` —
the same block the stage-action editor offers (after two days, up to three
times). The bulk panel is a single "Send reminders"
toggle rather than a second reminder editor: a dropdown over a board is not the
place to author a schedule, and inventing a second default would be a number that
could drift from the first.

### Position-wide email is select-all plus the existing bulk bar

"Email all candidates on this position" is not a different mechanism from
`POST /api/applications/bulk-email` — it is the same one with everybody
selected — so no second screen, route or dialog was built.

The board's Select mode gained a **Select all N** control that selects exactly the
filtered, ordered set the board is showing, and the positions list gained an
**Email all candidates** menu item that opens the board at
`?select=all`. From there the existing Send email panel does the work, and
"nobody is CC'd" is already what it says and what the route already does.

`?select=all` is read as a **derived default**, not copied into state by an
effect: the board holds `selectionOverride` (null until the user touches
anything) and falls back to the capped visible set. Same shape as the position
edit form's held-state-keyed-by-id, and for the same reason — React's
`set-state-in-effect` rule rejects the effect, and the derived version stays
correct as the filters change.

Changing a position's status and emailing its candidates stay uncoupled: closing
or pausing a position changes its status and notifies nobody. The menu item sits next to the
status transitions and is a separate, deliberate click.

### `MAX_BULK_SELECTION` is shown to the user, not applied behind their back

The cap in `schemas/bulk-candidate-schema.ts` used to be only a 422. It is now
also a UI rule: Select all takes the first 500 of the
ordered view, hand-selecting the 501st is refused, and in both cases the bulk bar
shows "A bulk action covers at most 500 candidates at a time. 500 of the 620 in
this view are selected — narrow the filters and run it again for the rest."

A cap that silently shortens a selection is the failure mode the bulk actions
avoid everywhere else: the user believes 620 people were emailed and
120 were not. Refusing loudly is worse UX and better behaviour.

### Profile prev/next carries the board's filters in the query string, and shows nothing rather than the wrong neighbour

The profile stays at `/candidates/[candidateId]`. Moving it under
`/positions/[id]/candidates/[appId]` was considered and rejected:
existing links break, and the profile is legitimately reachable from the Inbox and
from a person's other applications, where no position context exists at all.

So the context travels as query parameters — `?position=…&q=…&stages=…&starred=1`
and the rest — built by `candidateNavigationSearch` and read back by
`parseCandidateNavigationContext`, both in `utilities/candidate-navigation.ts`.
The **ordered id list is not** in the URL: five hundred uuids is not a URL, and the
profile can recompute the identical set from the same `["candidates", positionId]`
query the board uses, `orderedBoardCandidates` and the same
`matchesCandidateFilters` predicate. One filter implementation, two screens.

Three things make a stale context harmless, and all three answer with _no_
navigation rather than a guess:

1. **No `position` parameter** — the control does not render at all. Opening a
   profile from the Inbox shows no prev/next, which is honest: there is no view to
   be next in.
2. **A `position` that is not this application's** — treated as absent, for the
   same reason.
3. **The candidate is no longer in the recomputed set** — someone re-filtered,
   archived them, or moved them out of a stage filter — so `neighbouringCandidates`
   returns `{previousId: null, nextId: null}` and both arrows are disabled.

There is deliberately **no wrap-around**, which the previous cache-reading
implementation had. The first candidate has no previous and the last has no next.
Wrapping makes "next" mean "back to the beginning" without saying so, and the
disabled arrow is the truthful signal that the view has an end.

The neighbour arithmetic is `neighbouringCandidates(orderedIds, currentId)`, a
pure function over an array, so every edge — not present, single element, empty —
is a unit test rather than something to provoke through a rendered board.

### Bulk email is the same send path, one message at a time

`POST /api/applications/bulk-email` loops `dispatchMessage` over the selection and
answers `{sent, failures}` — the same partial-success shape, and the same
reasoning, as `POST /api/applications/bulk`. "Recipients do not see each
other" is structural rather than a rule to remember: there is one message per
candidate and the CC and BCC lists are empty.

It sends immediately and does not offer a scheduled bulk send; "Not yet built"
says why.

### The stage-actions screen addresses a stage by query, not by path

`/pipelines/stage-actions?positionId=…&stageId=…`. The screen is a drawer over
the board it was opened from, and the board is where a stage exists to be
configured — so the entry point is a per-column control on
`/positions/[id]/board`, and closing the drawer returns there.

A nested path (`/positions/[id]/stages/[stageId]/actions`) would read better in a
URL bar and was not taken: the design is a panel over the board rather than a
page of its own, and the route name was already registered and linked. Addressing no stage is a real state
and is handled — the drawer explains where stage actions live and links to
Positions rather than rendering an empty editor.

### Stopping a reminder run by hand is a timestamp, not a boolean

`questionnaire_responses.reminders_stopped_at` records _when_ someone called the
chase off, because that is the question asked afterwards. Setting it fires a
trigger that cancels the remaining pending reminders, so the API route
(`PATCH /api/questionnaire-responses/[id]`) does one UPDATE and the stop
condition is enforced whether it came from that route, from psql, or from
whatever writes it next. Clearing it does not reinstate the run: those rows are
terminal, and `schedule_questionnaire_reminders` refuses a response that has been
stopped. There is deliberately no "resume": the cancelled rows are terminal and
nothing would re-create them, so the control disappears once it has been used
rather than offering an undo that does nothing.

### `AuthProvider` calls `router.refresh()` on auth state change

Server Components and middleware cache per-request. Without the refresh, signing
in or out leaves stale server-rendered data on screen.

### A bulk action is many small writes, and reports each one

`POST /api/applications/bulk` takes `{applicationIds, patch}` and answers
`{updated, failures}`. It does **not** issue one `update(...).in("id", ids)`.

A single statement is one round trip and would be the obvious choice, but it
cannot say _which_ rows it missed — Postgres reports a count, and a candidate
that was deleted a second ago is indistinguishable from one that was updated.
A user can select twenty candidates at once, and "3 of 20 failed, and
here they are" is the only useful thing to tell them. So the route reads the
selection first, refuses the ineligible ones individually (missing row; a target
stage that belongs to a different position), then updates the remainder one
statement at a time in parallel and collects the errors.

The consequence is deliberate and is what the UI relies on: **there is no
transaction across the batch.** A partial run leaves the successful rows written.
The board keeps exactly the failures selected afterwards, so retrying re-attempts
only those, and the outcome copy says the rest went through — a partial result
that read as a rollback would be worse than the failure itself.

The status is **200 for a partial run**, not 207. Partial success is the designed
outcome here, not an exception; the caller has to read `failures` in every case,
so a second success code would add a branch without adding information. 4xx is
reserved for a request that was wrong as a whole — an unparseable body, an empty
selection, a `stageId` that names no stage anywhere.

### Export is a JSON read; the CSV is built in the browser

`POST /api/applications/export` returns `{records, missingIds}` — DTOs, like every
other route — and `utilities/candidate-export.ts` turns them into CSV on the
client. Keeping the route JSON means the file format is pure, isomorphic and unit
tested, rather than being asserted through a response body.

It is a POST despite being a read. A selection can run to hundreds of ids and a
`GET ?ids=…` would be several kilobytes of URL; the route is a read with a body,
which is the lesser compromise.

**Cells are neutralised against spreadsheet formula injection.** A value starting
`=`, `+`, `-`, `@`, tab or CR is prefixed with `'` before quoting. Candidate names,
headlines and application answers are attacker-supplied text that an internal
reviewer opens in Excel, so `=HYPERLINK("http://evil","Payslip")` in a "headline"
is the same trust boundary as `video-link.ts` and the rich-text link allowlist.
The accepted cost is that a genuinely negative number exports as `'-5000`.

**Only CSV.** The approved design offers CSV and Excel; a real `.xlsx` needs a
writer library, and no new dependency was taken for it. The format control is
therefore not built rather than built and faked.

**Which columns.** Nothing specified what an export contains. The columns come
from the approved design's own sentence — "name,
headline, stage, contact details, and application answers" — as twelve fixed
columns plus one column per application-form answer key present in the selection.
Answer columns are labelled from `APPLY_FIELD_DEFS` and ordered as the
application form orders them, with unknown keys last and sorted, so two exports
of the same position do not shuffle their columns.

### Every stage is a board column, and nothing is folded away

The board used to split stages in two: `active` and `success` became columns,
while `terminal` and `neutral` were collapsed into a narrow "Closed / rejected"
drawer down the right edge. `0043` removed `stage_type`, and the drawer went with
it.

Stages now render as plain columns in `sort_order`, and the board scrolls
horizontally. A pipeline with four rejection stages shows four rejection columns.
That is a deliberate trade: the drawer kept the working view short, but it needed
the app to know which stages were endings, and that knowledge is exactly what was
withdrawn. A manual per-column collapse was considered and deferred — it is a user
preference to store, not a property of a stage, and no requirement asks for it.

Board order is therefore just `sort_order`, which is also what the profile's prev/next
walks, so the two cannot disagree.

Stage dots lost their colour coding in the same change. Colour that encoded
`active` / `success` / `terminal` / `neutral` communicates nothing once those
categories are gone, so every dot is the one neutral tone rather than a new scheme
invented to fill the gap.

### The board's filter predicate is a pure module, not board state

`utilities/candidate-filters.ts` holds `CandidateFilters` and
`matchesCandidateFilters`. The filter set is now seven controls including two date
windows, and date arithmetic against `Date.now()` is exactly the kind of logic
that is painful to reach through a rendered board. The screen holds one
`CandidateFilters` object and does no filtering of its own.

`now` is a parameter, never read inside the predicate. That is what makes the
boundary cases ("exactly 7 days old", "timestamped in the future") assertable.

"Last activity" reads `applications.updated_at`, which is what the existing
`stageEnteredAt` DTO field already maps. There is no separate activity column,
so any write to the application — a stage move, a star, marking it seen — counts
as activity. That matches the design's mock, and a truer "last activity" would
need a column the schema does not have.

### The automation producer is a database trigger, not a Route Handler

`applications_stage_automation` fires `after insert or update of current_stage_id
on applications` (migration `0019`) and is the only thing that ever writes
`scheduled_actions`. Three code paths change a candidate's stage today — `PATCH
/api/applications/[id]`, `POST /api/applications/bulk`, and the `SECURITY
DEFINER` `submit_application` — and the third changes the stage inside SQL,
where no Route Handler code runs. A producer in the API layer would mean a public
application silently never fires the first stage's actions, and "first entry
only" would be a check every future caller had to remember.

Every helper takes the instant it should reason about (`p_now`), and only the
trigger reads `now()`. That is what lets pgTAP assert an hour's delay without
waiting an hour.

### "First entry only" is a ledger, because the queue cannot answer it

`application_stage_entries` holds one row per (application, stage) the candidacy
has ever reached, unique on that pair. `schedule_stage_actions` inserts into it
first and returns 0 without queueing anything when the insert conflicts.

The obvious cheaper test — "are there already queue rows from this stage?" — is
wrong in a way that only shows up later: a stage with no actions leaves no queue
rows, so if actions are added afterwards a re-entry fires them. The unique
constraint also settles the concurrent case, so two simultaneous moves cannot
both believe they are the first.

### An action fires exactly once because it is claimed, not because of timing

`claim_due_scheduled_actions(p_now, p_limit)` is one statement: a
`for update skip locked` sub-select over `status = 'pending' and scheduled_for <=
p_now`, feeding an UPDATE to `claimed`. Two workers running at the same instant
take disjoint sets — the second does not block and does not see the first's rows
— and the status change removes the row from the pending predicate permanently.
Nothing depends on cron runs not overlapping.

The state machine is enforced by `guard_scheduled_action_status`, a BEFORE UPDATE
trigger, and the legal moves are exactly:

```
pending ─┬─► claimed ─┬─► sent      the action executed
         │            ├─► failed    it ran and broke; failure_reason says how
         │            └─► skipped   a precondition no longer held
         └─► cancelled              the candidate left the stage
```

**`claimed → cancelled` is deliberately absent.** Once a worker owns a row it is
about to call the relay, and cancel-on-move must not race an in-flight send.
`sent` covers a `move_to_stage` that moved the candidate, so it reads as "the
action executed" rather than "an email went out".

The guard compares status only. Terminal rows still get updated by the
`on delete set null` foreign keys when a stage or a stage action is deleted, and
freezing whole rows would make deleting a stage fail once anything had fired from
it. `04`-style coverage for that is in `09_stage_automation.test.sql`.

### A worker that dies mid-batch loses the send; it does not repeat it

Claim, then send, then settle. If the process dies after claiming, the row sits
in `claimed` forever: no lease expiry, no automatic retry, no second delivery.
This is the same trade `dispatchMessage` already makes when it sends before
recording — **an email that has gone out cannot be recalled**, so the design
refuses to risk sending twice and accepts a send that did not happen.

Because that is only defensible if it is visible, `stalled_scheduled_actions` is
a view over `status = 'claimed'` carrying `claimed_for`. Anything in it for more
than a few minutes is a candidate not getting their email, and re-queueing it is
a deliberate human act, not something the system does behind your back.

### pg_cron rings a doorbell; the Next.js worker does the sending

The scheduler is pg_cron plus a queue table, and pg_cron cannot talk to Resend.
Everything that makes an outbound message correct — merge resolution, the link
allowlist, header-injection defence, attachment download, the failure row, the
send-then-record ordering, the RFC Message-ID fetch — lives in
`app/api/messages/_send.ts`, and a second mailer in plpgsql would drift from it
within a sprint.

So `dispatch_due_scheduled_actions` runs every minute, returns immediately if
nothing is due, and otherwise `pg_net`-POSTs `/api/workers/scheduled-actions`.
That route authenticates on `AUTOMATION_WORKER_SECRET` in constant time (no
session — the database has none), takes the service-role client, and calls
`dispatchMessage` with `displaySenderName({origin: "automated"})`. The POST is
fire-and-forget, which is safe precisely because claiming is atomic: a second
invocation arriving mid-run finds nothing left to take.

The endpoint URL and shared secret live in `automation_worker_config`, a
single-row table with RLS on and **no policy and no grants** — migrations are in
git and this row holds a credential. It ships `enabled = false`, so a freshly
restored database runs the cron job every minute and does nothing until an
operator fills it in.

### The worker re-checks the candidate's stage, and never guesses one

`utilities/scheduled-action-plan.ts` is a pure function: given the queue row's
origin stage, the application's current state and the stage action's
configuration, it returns send / move / skip-with-a-reason. It has no I/O, which
is why every re-check branch is a unit test rather than something you have to
provoke through a live queue.

Its order matters. Origin stage missing, then action deleted, then **stage
mismatch**, then archived, then the per-type checks — so a candidate who both
moved on and whose template was deleted is reported as having moved, which is the
cause rather than a symptom.

A `move_to_stage` whose target is null (the stage was deleted) or belongs to
another position is **skipped with the reason recorded**. It is never resolved to
the first stage, the next stage, or anything else. Same rule for answer
routing's `position_stage_for_template_stage`, which returns NULL when
`source_template_stage_id` has been severed. A silent wrong move in an ATS is
worse than no move.

### `failed` and `skipped` cannot be written without a reason

The check constraint on `scheduled_actions` ties every status to its columns:
`pending` may not carry a `claimed_at`, `claimed` must, a settled row must have a
`completed_at`, and `failed`/`skipped` must have a `failure_reason`. There is no
way to make an action disappear quietly, from SQL or from the application.

`complete_scheduled_action` only settles a row that is currently `claimed`, and
reports `false` rather than forcing a transition otherwise — so a confused worker
re-running a batch cannot overwrite a terminal outcome.

The run summary counts an outcome only once the settle succeeded, which makes
`claimed === sent + skipped + failed` an invariant worth reading: whenever the
left side is larger, that many rows are stuck in `claimed` and
`stalled_scheduled_actions` names them.

### A new function in `public` has two default EXECUTE grants, not one

0014 recorded the first: Supabase's default-privileges rule grants EXECUTE
directly to anon and authenticated at creation time, so `revoke ... from public`
alone leaves them. Postgres's own implicit grant to PUBLIC is the second, and
revoking only the named ones leaves the function callable through it — which is
exactly what happened to `dispatch_due_scheduled_actions` between `0020` and
`0021`, and what the advisor caught.

**Revoke from PUBLIC and from anon.** Both.
`06_function_exposure.test.sql` now asserts both for all eleven automation-engine functions, so
the next one added cannot quietly land on the anonymous API.

### The rule applies backwards too, and the suite is what enforces it

`0021` fixed every function from `0019` onwards and nobody went back. Four older
ones still carried the full default set: `set_updated_at` (`0001`),
`snapshot_pipeline_to_position` and `first_stage_for_position` (`0002`), and
`submit_application` (`0005`, granted to `anon` on purpose and never revoked from
PUBLIC). `0037` closes all four.

None was exploitable and this is not a claim that one was — `set_updated_at`
errors on `NEW` when called directly, and the other two are SECURITY INVOKER so
anon's empty RLS view applies. They went unnoticed for one reason worth writing
down: **the test suite only asserted the functions somebody had already thought
about.** Coverage that follows the last fix rather than the whole surface will
always be one generation behind, which is why `06` now names these four as well.

`0037` kept two grants rather than dropping them. `snapshot_pipeline_to_position`
stays callable by `authenticated` because `POST /api/positions` calls it with a
session, and the suite asserts that in the positive direction.
`submit_application` kept `anon` and `authenticated` because `/api/apply` then
called it with the visitor's own client. That second one no longer holds: `0049`
moved both public submit functions to the service role alone, once the intake
routes used it.

`set_updated_at` loses EXECUTE from every role, and `06` asserts as _behaviour_
that six tables still stamp `updated_at` afterwards — EXECUTE is checked when a
trigger is created, not each time it fires. That assertion is worth its line
because the failure would otherwise be silent: a stale timestamp is not an error.

### The questionnaire builder no longer drops anything

The builder once offered settings it never saved. Per-option answer routing and
the on-completion stage are persisted, and migration `0024` added
`questions.video_allow_retakes`, `numeric_min` and `numeric_max` so those are
persisted too.

Each column is tied to its question type by a check constraint, the same rule the
automation payload columns follow: a numeric bound on a video question is not a
harmless stray value, it is a row nothing downstream knows how to read.
`toQuestionRow` nulls the irrelevant ones on the way in, so the constraint is a
backstop rather than something every caller has to remember.

The bounds are `numeric`, not integer, because the question type accepts any
number and an integer column would silently round 2.5. An inverted range is
refused by Zod with a message the builder already surfaces — it is **not**
silently swapped, because a control that quietly rewrites what you typed is the
same class of fault as one that discards it.

`video_allow_retakes` is nullable rather than `not null default true`, so a
question saved before this migration reads as "no opinion" and the builder
defaults it to allowing retakes, instead of the schema asserting a preference
nobody expressed.

### L3 pauses the worker's cron job, because a live queue eats its test data

`tests/integration/global-setup.ts` deactivates `brainbox-scheduled-actions` on
setup and reactivates it on teardown. This is not tidiness — without it the suite
takes **1317 seconds and fails**; with it, **54 seconds and passes**.

The worker claims due rows with `for update skip locked`. When `pg_cron` fires
every minute against the same database the tests run on, it takes the rows a test
has just queued and is about to process itself. The test then waits on a state
that no longer exists and times out. Nothing is wrong with either the worker or
the test — they are simply two consumers of one queue.

The failure is worth recognising by shape, because it does not look like what it
is: assertions pass, durations explode, and the tests that break are ones nobody
edited. It only became possible when the engine went live, so it will not appear
in any earlier run.

Pausing uses `cron.alter_job(jobid, active := …)`. A direct
`update cron.job set active = …` fails with `permission denied for table job` —
the connecting role may call the API but not write the table. Pausing is also
deliberately chosen over `cron.unschedule`: a crashed run leaves the job paused,
which the next run repairs, whereas an unschedule that never re-schedules loses
the job entirely.

**The general rule this stands for: a live worker and a test suite should not
share a database.** The L3 and L4 suites run against the staging project, which
is why the job is paused for a run. Production is a separate Supabase project,
and no test ever points at it.

### L3 never writes to the Slack singletons — it injects the delivery config instead

Same lesson as the cron job above, found the same way: a test suite and live
state sharing one row.

`slack_config` and `slack_credentials` hold exactly one row each. The first
version of `slack-notifications.test.ts` configured Slack by writing to them —
test channel, test token — and restored nothing. A real workspace had been
configured minutes earlier; the suite silently replaced the channel with
`CL3SLACKTEST` and the real bot token with a fake one, and the next genuine post
failed with `invalid_auth`. Nothing in the run failed. On a real deployment that
surfaces as "a candidate reply nobody noticed", days later.

Snapshot-and-restore was rejected. It leaves a crash window: an interrupted run
leaves test values live precisely when nobody is watching, which is the same
failure with extra steps. Instead the read is a seam.
`configurations/slack-delivery-config.ts` exists solely so that
`readSlackDeliveryConfig` can be replaced by `vi.mock`, exactly as
`_email-transport-mock.ts` replaces the email transport. The L3 suite writes to
neither singleton, so there is no state to restore and nothing to leak.

The cost of a seam is that the real function stops being exercised, and
`slack_delivery_config()` must work in production or Slack silently goes quiet.
So two tests use `vi.importActual` to call the real reader read-only: one asserts
the service role resolves a well-formed row (shape only — never the token's
value), and one asserts a signed-in session cannot call it at all. Neither
writes.

**The general rule: when a test needs a singleton to say something particular,
inject the read. Do not write the row and hope the restore runs.**

### An inbound-email Slack notification is delivered inline, not through `scheduled_actions`

The automation queue looked like the obvious home for it, and is the wrong one
for three concrete reasons:

1. `scheduled_actions.application_id` is `not null`. An inbound email from a
   person with no application is an ordinary case — `contextFor` in `_receive.ts`
   returns null, and the `messages` row allows it. Those queue rows could not
   exist without relaxing a core invariant of the engine.
2. Cancel-on-move (`cancel_pending_stage_actions`) cancels every pending row for an
   application whose origin stage the candidate has left. Move a candidate a
   minute after they reply and the notification is cancelled, for reasons that
   have nothing to do with Slack.
3. The queue has no retries, so routing through it buys deferral and a status
   column, and `slack_notifications` supplies the status column directly.

So the webhook awaits `notifySlackOfInboundEmail` after the `recorded` outcome.
Three properties make that safe, and all three are load-bearing:

- **It cannot throw.** Every path returns an outcome; the whole body is wrapped.
  A thrown error would become a 500, Resend would retry, and a retried inbound
  email is either lost mail or duplicated mail.
- **It is time-boxed.** `AbortSignal.timeout(SLACK_POST_TIMEOUT_MS)`. Slack
  hanging must not hold the webhook open until Resend's own timeout fires — that
  is a retry too.
- **Every outcome is recorded** in `slack_notifications`. Swallowed failures that
  leave no trace are how a subsystem dies unnoticed.

`slack-notifications.test.ts` proves the headline property against all three real
failure modes — rejected promise, non-2xx, and a Slack that never answers — and
asserts the webhook still returns 200 and the message is still in `messages`.

### The Slack bot token is write-only from the UI's perspective

`slack_config` (channel, on/off) is ordinary configuration that every internal
user reads. The bot token is a workspace-wide bearer credential and lives in a
separate table, `slack_credentials`, under the `automation_worker_config`
treatment from `0020`: RLS on with **no policy**, and table grants revoked from
`anon` and `authenticated` so it is off the PostgREST surface entirely.

Three functions are the whole interface. `set_slack_bot_token(text)` writes and
returns a boolean. `slack_bot_token_state()` returns a configured flag and a
set-at timestamp. `slack_delivery_config()` returns the token and is granted to
`service_role` alone — it is the token's one named exit from the database, which
is a thing a reviewer can grep for in a way that a bare
`.from("slack_credentials")` is not.

There is deliberately **no** function that shows the token to a signed-in user —
not masked, not the last four characters, not "for confirmation". A partially
revealed secret is revealed in the only way that matters, and a UI that displays
`xoxb-••••1234` teaches operators that the app will show them the token, which is
the habit that makes the next leak possible. Losing it means creating a new one
in Slack. `06_function_exposure.test.sql` asserts every grant in both directions.

### A reporting month is a half-open UTC interval, and it is the same one everywhere

`/reports` filters by month, and "this month" is ambiguous enough to be a bug on
its own. The rule is fixed in `0030` and nowhere else:

```
[ first day of the month 00:00 UTC , first day of the next month 00:00 UTC )
```

Every figure on the screen comes from `report_month_applications(p_month)`, which
applies that window once, so no two cards can disagree about where June starts.
`report_month_start` / `report_month_end` are the only places the boundary is
computed, and they do `p_month::timestamp at time zone 'UTC'` rather than
`p_month::timestamptz` — the direct cast would read the date in whatever
`TimeZone` the session carries, and the same report would then move by hours
between a psql session and PostgREST. `12_reporting.test.sql` asserts a UTC+13
and a UTC-10 session get the identical boundary.

UTC rather than a company-local zone because no company time zone exists anywhere
in this schema, and inventing one would put the same application in
different months for different readers. UTC also has no DST discontinuity, so
adding one month cannot produce a 23- or 25-hour day.

**The cost, stated plainly:** an application submitted at 00:30 on 1 June by
someone in London (BST, UTC+1) happened at 23:30 UTC on 31 May and is counted in
**May**. A London reader will not find it in the June report. That is the price of
one boundary for everybody, and it is the reason to revisit this the moment a
company time-zone setting exists.

The browser never computes the month. `GET /api/reports` with no `month`
parameter answers for the current UTC month and echoes back which month it
answered for, so the server's clock is the only one in play.

### The stage bars are a cohort, not a snapshot of the board

"Candidates by stage" answers _of the people who applied in June, where do they
stand now?_ — not _where did the board stand on 30 June_. The two are different
numbers and the screen says which one it shows.

The point-in-time version is not attempted because the schema cannot support it:
`application_stage_entries` records only the **first** entry into a stage, and
only since `0019`. Reconstructing a historical board from that would be guessing,
and a plausible-looking wrong number is worse than an absent one.

The cohort choice is also what makes the month filter drive the entire page
rather than most of it, and why the position table's Total row necessarily equals
the KPI row.

### There are no outcomes, because a stage no longer means anything

Reporting used to classify every application as `hired`, `rejected`, `archived` or
`in_pipeline`, derived from the stage's `stage_type`. `0043` removed both the
classification and the column.

The reason is that `stage_type` asked the operator to tell the database something
they had already said by naming the stage. A team whose stages read *Applied ·
Deep dive · Programming · Joined the team · Doesn't meet hiring criteria* has
expressed the process completely; being asked to additionally mark two of those
`success` and `terminal` is asking the same question twice, and the answer only
ever fed three cards on one screen. It never touched emails, automations, routing
or anything a recruiter does daily.

So the report now counts and does not judge. `report_monthly_position_stages`
returns a count per stage per position, in that position's own `sort_order`, and
the reader decides what "Doesn't meet hiring criteria" means — which is what they
were doing anyway.

The cost, stated plainly because it is a real loss: **nothing can answer "how many
did we hire in August" as one cross-position number.** You read the hires off the
stages you know are hires. That was the accepted trade.

`archived` survives as a flag on `report_monthly_totals`, not as a bucket, because
archiving never moves a candidate out of their stage.

### Archived applications are counted once, and not in the stage bars

`report_monthly_totals.applications_received` includes archived applications;
`report_monthly_position_stages` excludes them. So a position's stage counts sum
to its applications received **minus** its archived applications, and the screen
prints a footnote when `archived > 0`.

Counting them in their stage was the alternative and it was rejected: the board
hides archived rows by default, so a report reading "Applied: 12" beside a board
showing nine cards sends someone hunting a bug that does not exist. Agreeing with
the board beats a sum that needs no footnote.

### Weekly bars are day-of-month quarters, not ISO weeks

W1 = days 1–7, W2 = 8–14, W3 = 15–21, W4 = 22 to month end. ISO weeks would
straddle the month boundary and produce five or six ragged bars whose ends fall
outside the window the rest of the page is filtered by.

The trade is that W4 is nine or ten days long and therefore runs high, which the
chart subtitle states. What the buckets buy is that they tile the month exactly,
so the four bars sum to applications received for any month of any length,
February included — asserted in `12_reporting.test.sql` against a 31-day month
with one application on every day.

`generate_series(1, 4)` on the left of the join means all four rows always come
back, at zero if need be. A chart that silently loses a bar is worse than one
showing a zero.

### Stage counts group by position, never by stage name

`report_monthly_stages` grouped by `(stage_name, stage_type)` with no position in
the key. That merged every position's "Applied" into one bar — and silently added
unrelated pipelines together, so two teams running different processes that both
happened to call a stage "Screening" were reported as one number. The function was
deleted rather than fixed.

`report_monthly_position_stages` groups by `position_id` and `stage_id`, which
cannot merge stages that were never the same stage: `position_stages` is a
per-position snapshot, so a stage id belongs to exactly one position and one
pipeline. The screen renders one card per position.

Two consequences worth knowing:

**Position titles are not unique**, and the report does not pretend otherwise.
Several positions may legitimately share a title (a role reposted next quarter),
so every lookup and every React key is on `position_id`. Grouping or joining on
title produces a fan-out — which is exactly how the first hand-verification of
this function appeared to fail before the query was corrected.

**Ordering within a position is load-bearing; ordering between positions is not.**
Stages come back in the position's own `sort_order`, never alphabetically or by
size, because a report that reorders a hiring process misrepresents it.
Applications with no current stage appear as "No stage" with a null `stage_id`
rather than being dropped. Positions are walked in the order
`report_monthly_positions` returns them (busiest first, then title), so
`report_monthly_position_stages` does not reproduce that ranking.

### Zero denominators, and what an empty month renders

There is no rate or percentage anywhere in this report — conversion rates and
time-to-hire are not built, so nothing divides one metric by another. The only division is
bar sizing, and `barHeightPercent` returns `0` when the largest bar is `0`, so an
empty month draws four flat bars rather than `NaN`-height ones.

A brand-new account with no applications at all still renders: the totals
function returns one row of zeroes rather than zero rows, the weeks function
returns four zero bars, and `report_available_months` unions in the current month
unconditionally so the dropdown is never empty. The screen then shows the "No
activity in <month>" empty state rather than a page of zeroes.

### Conversion rates are not built, and the design shows more than the report does

Conversion rates, time-to-hire, and source and recruiter attribution are out of
scope. Nothing in the reporting functions computes a ratio between two stages or
a duration, and the approved design's `+22% vs last month` KPI deltas are **not**
implemented — a month-over-month comparison was not asked for, and it would have
needed its own zero-denominator rule for a first month. Where the design and the
product's scope disagreed, the scope won.

The same rule decided the KPI row. The design shows four cards — applications
received, in pipeline, hired, rejected — and three of them require the stage
classification `0043` removed. The report's scope is applications received and
candidate counts by stage, both of which survive, so the row is now the one card
that scope names.

### A scheduled message is drained by the automation worker, not by a second one

`0015` gave `messages` a `scheduled_for`, a status vocabulary and the partial
index `messages_due_outbound_idx`, then stopped. For a while nothing consumed a
due row: a message scheduled from the composer sat in the table forever
and silently never sent. `0034` and `0035` close that.

The consumer is **the worker that already exists**. `/api/workers/scheduled-actions`
now runs two drains per invocation — `runDueScheduledActions` over
`scheduled_actions`, then `runDueScheduledMessages` over `messages` — and answers
`{ actions, messages }` instead of a bare action summary.

Extending it was a deliberate choice over adding a sibling. A second worker would
mean a second shared secret to rotate, a second row of
`automation_worker_config` for an operator to fill in on every deployment, a
second `pg_cron` job that can be paused independently of the first (and that the
L3 harness would separately have to remember to pause), and a second thing to
notice is broken. The two queues are different tables with different claim
functions; they are not different _operations_. `0035` widens the doorbell's
"is anything due?" predicate to an OR over both queues and changes nothing else.

The route keeps its `scheduled-actions` path, which now under-describes it. The
path is stored by hand in `automation_worker_config.endpoint_url` on every
deployment, so renaming it would silently stop the engine on any database whose
row was not updated in the same breath. A misleading URL is the cheaper mistake.

### A scheduled message sends exactly once because it is claimed, not because of timing

`claim_due_messages(p_now, p_limit)` is the same one statement as
`claim_due_scheduled_actions`: a `for update skip locked` sub-select over
`direction = 'outbound' and status = 'scheduled' and scheduled_for <= p_now`,
feeding an UPDATE to `sending`. Two workers running at the same instant take
disjoint sets, and the status change removes the row from the due predicate for
good.

```
(insert) ──► sent                  an immediate send; scheduled_for stays null
(insert) ──► failed                the relay rejected an immediate send
(insert) ──► scheduled ─┬─► sending ─┬─► sent      the worker delivered it
                        │            └─► failed    the relay rejected it
                        └─► cancelled              a human stopped it in time
```

`guard_message_send_status`, a BEFORE UPDATE trigger, is what makes that total:
the four listed transitions are legal and every other status change raises,
including from a hand-written UPDATE in psql. **`sending → cancelled` is absent
on purpose**, for exactly the reason `claimed → cancelled` is absent for
scheduled actions — once a worker owns the row it is about to call the relay, and
an email that has gone out cannot be recalled, so the losing move is the cancel.

Settling goes through `complete_scheduled_message`, which only touches a row in
`sending`, refuses any status but `sent`/`failed`, and refuses a `failed` with no
reason. A confused worker cannot overwrite a terminal outcome.

**When the worker dies mid-batch, the send is lost, not repeated.** Claim, then
send, then settle: a process that dies after claiming leaves the row in `sending`
forever — no lease expiry, no automatic retry, no second delivery. This is the
same trade `dispatchMessage` already makes by sending before recording. Because
that is only defensible if it is visible, `stalled_scheduled_messages` is a view
over `status = 'sending'` carrying `claimed_for`, the mirror of
`stalled_scheduled_actions`. Anything in it for more than a few minutes is a
candidate whose email did not go out, and re-queueing it is a human act.

### The queue field is cleared when a message leaves the queue

`0015` asserted that a non-`scheduled` row must have a null `scheduled_for`, so
that a settled row could never be picked up again. `0034` keeps that rule rather
than relaxing it, and widens it only to the two new states that describe a send
which has not yet happened: `sending` and `cancelled` must both carry the time,
`sent` and `failed` must not. `complete_scheduled_message` therefore nulls
`scheduled_for` as it settles.

The cost is that a delivered message no longer says what time it was originally
scheduled for. `send_claimed_at` is what replaces it: set at claim time and kept
through the terminal states, it says the row came out of the queue rather than
being sent inline, and read against `sent_at` it says how long the relay call
took. A reviewer could reasonably prefer keeping `scheduled_for` on a sent row
and dropping the invariant; the invariant won because it is the one an existing
L4 test already names, and because "the queue column is empty when the row is not
in the queue" is easier to reason about than "it might be, depending".

### A scheduled message is composed once, at compose time, and delivered as written

The queued row holds the _resolved_ subject and the rendered HTML body, not the
template. Merge variables, the rich-text link allowlist and the header-injection
defence all ran when the recruiter pressed Schedule, so what they previewed is
what goes out, even if the candidate's name or the position's salary changes in
the meantime.

That is why the worker cannot call `sendTemplatedEmail` — that function composes
and inserts a new row, and this row already exists. What it reuses instead is
`deliverToRelay`, extracted from `dispatchMessage` in `_send.ts`: reply headers,
Message-ID generation, the transport call and the failure normalisation, in one
place with exactly one caller of `getEmailTransport().send`. The immediate path
and the drain both go through it, so there is still only one sender.

Two consequences worth knowing. The plain-text alternative is regenerated with
`htmlToPlainText` rather than re-rendered from the source markup, because the
source is not kept — the same function the Inbox already uses to display an
outbound body. And attachments are downloaded from Storage at send time, so an
attachment deleted between scheduling and sending fails the message with a
reason rather than sending it silently truncated.

### Cancelling a scheduled send, and what "too late" means

`cancel_scheduled_message(p_id, p_now)` moves `scheduled → cancelled` and returns
whether it took. `POST /api/messages/[id]/cancel` turns a `false` into a 409 whose
wording depends on the row's actual state — already sending, already cancelled,
or never scheduled — because "cancel failed" with no reason is the kind of thing
a user retries forever.

Cancel is offered wherever a scheduled message is rendered: the candidate
profile's email thread and the Inbox conversation, both through the same
`ScheduledSendStatus` molecule. Composing is available from both entry
points — `/compose?applicationId=…` from the profile, and the Inbox reply
box — through one `useScheduleSend` hook and one `ScheduleSendToggle` /
`ScheduleSendPicker` pair, so the two composers cannot drift on what a valid send
time is.

**Cancel-on-move does not apply to a manually scheduled message.** Moving a
candidate out of a stage cancels that stage's pending `scheduled_actions`,
and deliberately does not touch a message a human scheduled by hand: the
recruiter chose to send that, and a stage change is not them changing their mind.
Cancelling it is their decision to make, which is what the button is for.

### Due-time arithmetic is a pure module, and `now` is always a parameter

`utilities/scheduled-send.ts` answers "is this requested time a schedule at all?"
with no I/O: no time at all is immediate; anything within
`SCHEDULE_TOLERANCE_MS` of now (or in the past) is immediate rather than an
error, because a user pressing Send on a stale picker means _now_; beyond
`MAX_SCHEDULE_HORIZON_DAYS` is rejected; anything else is a schedule. Both the
Route Handler and the two composers call the same function, so the API cannot
accept a time the UI would have refused, or the reverse.

`claim_due_messages` and `cancel_scheduled_message` take their instant the same
way, which is what lets the L4 suite assert "a due message is claimed exactly
once" without waiting an hour for one to come due.

### The candidate profile keeps no second copy of the candidate

The profile screen used to hold `starred` and `stageId` in `useState`, seeded
once from the profile it was handed. `useUpdateCandidate` rolled back correctly
on failure — but into the `["candidates", positionId]` cache, which this screen
never reads. A PATCH that 500'd therefore left the header showing the new stage,
and the star lit, for the rest of the session. `ProfileView` is keyed by
`applicationId`, so even the refetch could not put it right. A control that lies,
on the highest-traffic write path in the product.

**The mirrors are gone.** `starred` and `stageId` are read straight off
`profile.application`, and `useUpdateCandidate` now applies its optimistic patch
to _both_ caches — the board list and `["candidate-profile", id]` — snapshotting
and restoring both in `onMutate`/`onError`. The screen stays instant because the
optimistic write reaches the cache it actually renders from, and there is exactly
one place a stage can be un-done. The alternative — keeping the local state and
adding an `onError` that reverts it — would have left the second copy in place,
and the second copy is what caused this.

**A silent rollback is still a fault**, which is the other half. Every write on
this screen passes an `onError` that fills one `ActionFailure` and renders the
shared `ErrorAlert` under the header: the stage change, the star, the custom
attributes, the note, and the questionnaire reminder toggle. Starting any of
them clears the previous message, so the alert always describes the last thing
the user did.

**Two writes on this screen are not rolled back, on purpose.** The custom
attribute rows and the note box are text the user typed, not a copy of server
state; throwing that away on a 500 would lose their work. The note is no longer
cleared until the server has taken it (`onSuccess`, not fire-and-forget), the
attribute edits stay in the fields, and both say so in the alert. The board
(`pipeline-board-screen.tsx`) still rolls back silently and is a separate pass.

## Deliberately absent

Not oversights — these are out of scope by design: SMS/telephony, AI scoring, resume audit,
scorecards, interview scheduling, tasks, tags, roles and granular permissions,
talent pools, job-board distribution, manual add candidate, CSV import, nurture
campaigns, background checks, e-signatures, offers, multi-tenancy.
