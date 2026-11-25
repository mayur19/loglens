#!/usr/bin/env bash
# LogLens launcher: prerequisite checks, .env bootstrap, database setup and dev servers.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

BOLD=$'\033[1m'; GREEN=$'\033[32m'; YELLOW=$'\033[33m'; RED=$'\033[31m'; RESET=$'\033[0m'
info() { printf '%s==>%s %s\n' "$GREEN" "$RESET" "$*"; }
warn() { printf '%s!!%s %s\n' "$YELLOW" "$RESET" "$*"; }
die() { printf '%sxx%s %s\n' "$RED" "$RESET" "$*" >&2; exit 1; }

usage() {
  cat <<USAGE
${BOLD}LogLens${RESET} - log ingestion, LensQL search and alerting

Usage: ./run.sh <command>

Commands:
  help      Show this help
  setup     Check prerequisites, create .env, install deps, create databases, migrate and seed
  migrate   Apply pending SQL migrations to the dev database
  seed      Load demo data (idempotent)
  reset     Drop and recreate the dev schema, migrate and seed (never in production)
  test      Run lint, format check, typecheck and all test suites against the test database
  dev       Start the API (port \$API_PORT, default 4109) and web app (port \$WEB_PORT, default 5109)

With no command, runs setup (if needed) and then dev.
USAGE
}

require() {
  command -v "$1" >/dev/null 2>&1 || die "$1 is required but not installed. $2"
}

check_prereqs() {
  require node "Install Node.js 22 or newer (see .nvmrc)."
  require npm "npm ships with Node.js."
  require psql "Install PostgreSQL 15+ natively (e.g. 'brew install postgresql@17' or 'apt install postgresql')."
  local major
  major="$(node -p 'process.versions.node.split(".")[0]')"
  [ "$major" -ge 22 ] || die "Node.js 22+ required, found $(node -v)."
}

random_hex() {
  node -e 'process.stdout.write(require("node:crypto").randomBytes(32).toString("hex"))'
}

ensure_env() {
  if [ ! -f .env ]; then
    info "Creating .env from .env.example with a random SESSION_SECRET"
    sed "s/^SESSION_SECRET=.*/SESSION_SECRET=$(random_hex)/" .env.example > .env
  fi
  set -a
  # shellcheck disable=SC1091
  . ./.env
  set +a
}

db_name_from_url() {
  # postgresql:///loglens_dev?host=/tmp -> loglens_dev ; postgresql://u@h:5432/db -> db
  local url="$1"
  url="${url%%\?*}"
  printf '%s' "${url##*/}"
}

pg_admin_args() {
  local url="$1" host
  host="$(printf '%s' "$url" | sed -n 's/.*[?&]host=\([^&]*\).*/\1/p')"
  if [ -n "$host" ]; then printf -- '-h %s' "$host"; fi
}

ensure_database() {
  local url="$1" name args
  name="$(db_name_from_url "$url")"
  args="$(pg_admin_args "$url")"
  # shellcheck disable=SC2086
  if ! psql $args -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname = '$name'" | grep -q 1; then
    info "Creating database $name"
    # shellcheck disable=SC2086
    createdb $args "$name" || die "Could not create $name. Is PostgreSQL running and does your OS user have CREATEDB?"
  fi
}

cmd_setup() {
  check_prereqs
  ensure_env
  if [ ! -d node_modules ]; then info "Installing dependencies"; npm install --no-audit --no-fund; fi
  ensure_database "$DATABASE_URL"
  ensure_database "$TEST_DATABASE_URL"
  cmd_migrate
  cmd_seed
  info "Setup complete. Run ./run.sh dev and open http://localhost:${WEB_PORT:-5109}"
}

cmd_migrate() { ensure_env; npm run --silent db:migrate; }
cmd_seed() { ensure_env; npm run --silent db:seed; }

cmd_reset() {
  ensure_env
  [ "${NODE_ENV:-development}" != "production" ] || die "Refusing to reset in production"
  warn "This drops every table in $(db_name_from_url "$DATABASE_URL")."
  npm run --silent db:reset
}

cmd_test() {
  ensure_env
  ensure_database "$TEST_DATABASE_URL"
  npm run lint
  npm run format:check
  npm run typecheck
  TEST_DATABASE_URL="$TEST_DATABASE_URL" npm test
}

cmd_dev() {
  ensure_env
  info "API http://${API_HOST:-127.0.0.1}:${API_PORT:-4109}  Web http://localhost:${WEB_PORT:-5109}"
  npm run dev
}

case "${1:-}" in
  help | -h | --help) usage ;;
  setup) cmd_setup ;;
  migrate) cmd_migrate ;;
  seed) cmd_seed ;;
  reset) cmd_reset ;;
  test) cmd_test ;;
  dev) cmd_dev ;;
  "")
    [ -f .env ] && [ -d node_modules ] || cmd_setup
    cmd_dev
    ;;
  *) usage; exit 1 ;;
esac
