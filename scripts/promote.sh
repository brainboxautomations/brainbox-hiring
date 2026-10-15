#!/usr/bin/env bash
#
# promote.sh — promote dev to production (two-repo model).
#
# Dev lives in this repo (remote: origin). Prod is a SEPARATE private GitHub
# repo (remote: prod) that only deployers can access. Prod Amplify builds
# from prod/main.
#
# What it does, in order:
#   1. Make sure local `main` matches origin/main and that CI passed on it.
#   2. Show which migrations prod has not seen yet (dry run).
#   3. Back up the prod database (skipped on the very first promote, when
#      there is nothing to back up).
#   4. Apply the pending migrations to the PROD Supabase project.
#      Only unseen migration files run. Rows are never copied or deleted.
#      supabase/seed.sql is never run against prod.
#   5. Push main to prod/main, which triggers the prod Amplify build.
#
# It does NOT copy data and does NOT touch secrets. Prod has its own Supabase
# data and its own Amplify environment variables.
#
# One-time setup on the machine that runs this:
#   - git, gh (logged in), supabase CLI, psql, pg_dump
#   - git remote add prod https://github.com/<owner>/<prod-repo>.git
#   - cp scripts/.env.promote.example scripts/.env.promote and fill it in.
#     The file is gitignored. It needs at least EXPECTED_PROD_DB_REF (your
#     production Supabase project ref); every other variable has a default.
#     A variable already set in your shell wins over the file.
#   - export PROD_DB_URL="postgresql://postgres.<prod-ref>:<pwd>@aws-0-<region>.pooler.supabase.com:5432/postgres"
#     Session pooler on port 5432. The direct db.<ref>.supabase.co host is
#     IPv6-only and unreachable from many networks.
#
# Usage:
#   ./scripts/promote.sh                  # interactive, asks for confirmation
#   ./scripts/promote.sh --dry-run        # show what would happen, change nothing
#   ./scripts/promote.sh --yes            # skip the confirmation prompt
#   ./scripts/promote.sh --skip-db        # push code only, no backup or migrations
#   ./scripts/promote.sh --skip-ci-check  # promote even if CI has not passed
#
set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel)"
cd "$REPO_ROOT"

CONFIG_FILE="$REPO_ROOT/scripts/.env.promote"
CONFIG_VARS="DEV_REMOTE DEV_BRANCH PROD_REMOTE PROD_BRANCH DEV_REPO CI_WORKFLOW EXPECTED_PROD_DB_REF PROMOTE_BACKUP_DIR"
if [[ -f "$CONFIG_FILE" ]]; then
  # shellcheck disable=SC2086
  shell_values="$(declare -p $CONFIG_VARS 2>/dev/null || true)"
  # shellcheck source=/dev/null
  source "$CONFIG_FILE"
  eval "$shell_values"
fi

DEV_REMOTE="${DEV_REMOTE:-origin}"
DEV_BRANCH="${DEV_BRANCH:-main}"
PROD_REMOTE="${PROD_REMOTE:-prod}"
PROD_BRANCH="${PROD_BRANCH:-main}"
DEV_REPO="${DEV_REPO:-}"
CI_WORKFLOW="${CI_WORKFLOW:-CI}"
EXPECTED_PROD_DB_REF="${EXPECTED_PROD_DB_REF:-}"
BACKUP_DIR="${PROMOTE_BACKUP_DIR:-$HOME/prod-db-backups}"

mask_db_url() {
  sed -E 's#(://[^:]+):[^@]+@#\1:****@#' <<<"$1"
}

die() {
  echo "ERROR: $*" >&2
  exit 1
}

AUTO_YES=0
SKIP_DB=0
SKIP_CI=0
DRY_RUN=0
for arg in "$@"; do
  case "$arg" in
    --yes) AUTO_YES=1 ;;
    --skip-db) SKIP_DB=1 ;;
    --skip-ci-check) SKIP_CI=1 ;;
    --dry-run) DRY_RUN=1 ;;
    *) die "Unknown argument: $arg" ;;
  esac
done

# --- preconditions ---------------------------------------------------------

command -v git >/dev/null || die "git not found."
git remote get-url "$PROD_REMOTE" >/dev/null 2>&1 \
  || die "git remote '$PROD_REMOTE' not found. Add it once: git remote add $PROD_REMOTE <prod-repo-url>"

if [[ "$SKIP_DB" -eq 0 ]]; then
  command -v supabase >/dev/null || die "supabase CLI not found."
  command -v psql >/dev/null || die "psql not found."
  command -v pg_dump >/dev/null || die "pg_dump not found."
  [[ -n "$EXPECTED_PROD_DB_REF" ]] \
    || die "EXPECTED_PROD_DB_REF is not set. Put your prod Supabase project ref in scripts/.env.promote, or pass --skip-db."
  [[ -n "${PROD_DB_URL:-}" ]] \
    || die "PROD_DB_URL is not set. Export the prod connection string, or pass --skip-db."
  if [[ "$PROD_DB_URL" != *"$EXPECTED_PROD_DB_REF"* ]]; then
    echo "ERROR: PROD_DB_URL does not point at the production project." >&2
    echo "       expected ref: $EXPECTED_PROD_DB_REF" >&2
    echo "       actual:       $(mask_db_url "$PROD_DB_URL")" >&2
    exit 1
  fi
fi

if [[ "$SKIP_CI" -eq 0 ]]; then
  command -v gh >/dev/null || die "gh CLI not found (or pass --skip-ci-check)."
  gh auth status >/dev/null 2>&1 || die "gh is not logged in. Run 'gh auth login' (or pass --skip-ci-check)."
  if [[ -z "$DEV_REPO" ]]; then
    dev_url="$(git remote get-url "$DEV_REMOTE" 2>/dev/null)" \
      || die "git remote '$DEV_REMOTE' not found. Set DEV_REMOTE in scripts/.env.promote."
    DEV_REPO="$(sed -E 's#^[a-z+]+://[^/]+/##; s#^[^@/]+@[^:]+:##; s#/+$##; s#\.git$##' <<<"$dev_url")"
  fi
  [[ "$DEV_REPO" =~ ^[^/[:space:]]+/[^/[:space:]]+$ ]] \
    || die "cannot tell the GitHub repo for the CI check from '$DEV_REMOTE'. Set DEV_REPO=<owner>/<name> in scripts/.env.promote."
fi

if [[ -n "$(git status --porcelain)" ]]; then
  [[ "$DRY_RUN" -eq 1 ]] || die "working tree is dirty. Commit or stash before promoting."
  echo "WARN: working tree is dirty (ignored for --dry-run)."
fi

# --- 1. sync dev and check CI ---------------------------------------------

echo "==> 1/5  Syncing $DEV_BRANCH from $DEV_REMOTE"
git checkout -q "$DEV_BRANCH"
git pull -q --ff-only "$DEV_REMOTE" "$DEV_BRANCH"
git fetch -q "$PROD_REMOTE" 2>/dev/null || true

SHA="$(git rev-parse HEAD)"
SHORT_SHA="$(git rev-parse --short HEAD)"

if [[ "$SKIP_CI" -eq 1 ]]; then
  echo "    Skipping CI check (--skip-ci-check)"
else
  ci="$(gh run list --repo "$DEV_REPO" --workflow "$CI_WORKFLOW" --commit "$SHA" \
          --json status,conclusion --limit 1 \
          --jq '.[0] | "\(.status) \(.conclusion)"' 2>/dev/null || true)"
  case "$ci" in
    "completed success") echo "    CI passed on $SHORT_SHA" ;;
    "") die "no CI run found for $SHORT_SHA. Wait for CI, or pass --skip-ci-check." ;;
    completed*) die "CI did not pass on $SHORT_SHA ($ci). Fix it before promoting." ;;
    *) die "CI is still running on $SHORT_SHA ($ci). Wait for it to finish." ;;
  esac
fi

# --- 2. preview ------------------------------------------------------------

echo
echo "Commits that will ship to prod:"
if git rev-parse -q --verify "$PROD_REMOTE/$PROD_BRANCH" >/dev/null; then
  git --no-pager log --oneline "$PROD_REMOTE/$PROD_BRANCH..$DEV_BRANCH" | sed 's/^/    /'
  [[ -n "$(git log --oneline "$PROD_REMOTE/$PROD_BRANCH..$DEV_BRANCH")" ]] || echo "    (none, prod already has $SHORT_SHA)"
else
  echo "    (prod repo is empty, this first promote seeds it with the full history)"
fi

FIRST_DB_PROMOTE=0
if [[ "$SKIP_DB" -eq 0 ]]; then
  echo
  echo "Target prod DB: $(mask_db_url "$PROD_DB_URL")"
  has_history="$(psql "$PROD_DB_URL" -Atqc \
    "select to_regclass('supabase_migrations.schema_migrations') is not null" 2>/dev/null)" \
    || die "cannot connect to the prod database. Check PROD_DB_URL and the password."
  [[ "$has_history" == "t" ]] || FIRST_DB_PROMOTE=1

  echo
  echo "==> 2/5  Pending migrations (dry run):"
  supabase db push --db-url "$PROD_DB_URL" --dry-run 2>&1 | sed 's/^/    /'
fi

if [[ "$DRY_RUN" -eq 1 ]]; then
  echo
  echo "Dry run: nothing was changed."
  exit 0
fi

if [[ "$AUTO_YES" -eq 0 ]]; then
  echo
  prompt="Back up, migrate PROD and deploy $SHORT_SHA? Type 'promote' to continue: "
  [[ "$SKIP_DB" -eq 1 ]] && prompt="Push $SHORT_SHA to PROD (NO DB migrations)? Type 'promote' to continue: "
  read -r -p "$prompt" ans
  [[ "$ans" == "promote" ]] || { echo "Aborted."; exit 1; }
fi

# --- 3. back up prod -------------------------------------------------------

if [[ "$SKIP_DB" -eq 1 ]]; then
  echo "==> 3/5  Skipping backup (--skip-db)"
elif [[ "$FIRST_DB_PROMOTE" -eq 1 ]]; then
  echo "==> 3/5  Skipping backup (first promote, prod has no migration history yet)"
else
  mkdir -p "$BACKUP_DIR"
  backup="$BACKUP_DIR/prod-$(date +%Y%m%d-%H%M%S)-before-$SHORT_SHA.dump"
  echo "==> 3/5  Backing up prod to $backup"
  pg_dump "$PROD_DB_URL" --format=custom --no-owner --no-privileges \
    --schema=public --schema=supabase_migrations --file="$backup"
  echo "    $(du -h "$backup" | cut -f1) written"
fi

# --- 4. migrate prod -------------------------------------------------------

if [[ "$SKIP_DB" -eq 1 ]]; then
  echo "==> 4/5  Skipping DB migrations (--skip-db)"
else
  echo "==> 4/5  Applying pending migrations to PROD"
  supabase db push --db-url "$PROD_DB_URL" --yes
fi

# --- 5. push code to the prod repo ----------------------------------------

echo "==> 5/5  Pushing $DEV_BRANCH ($SHORT_SHA) -> $PROD_REMOTE/$PROD_BRANCH"
git push "$PROD_REMOTE" "$DEV_BRANCH:$PROD_BRANCH"

echo
echo "Done. Prod DB migrated; prod Amplify is now building $SHORT_SHA from the prod repo."
echo "Watch the build in the AWS Amplify console. Prod is live when it goes green."

if [[ "$FIRST_DB_PROMOTE" -eq 1 ]]; then
  cat <<'EOF'

First promote: these one-time steps are still manual.
  1. Point the automation worker at prod (in the prod SQL editor):
       update automation_worker_config
          set endpoint_url  = 'https://<prod-domain>/api/workers/scheduled-actions',
              shared_secret = '<same value as AUTOMATION_WORKER_SECRET in Amplify>',
              enabled       = true;
  2. Create the first admin user in Supabase Auth.
  3. Smoke test: apply, questionnaire link, send email, reply, automation, Slack.
EOF
fi
