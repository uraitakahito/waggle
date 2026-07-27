#!/usr/bin/env bash
#
# End-to-end smoke test of the production image against a real stack.
#
# Brings the stack up with container-compose, waits for BrowserHive to answer,
# then runs migrate → seed → one capture from the freshly built waggle image,
# and tears everything down through an EXIT trap.
#
# The one-shot jobs are `container run` rather than compose services:
# container-compose has exactly four subcommands (up / down / build / version),
# so there is no `run` to lean on. Calling the runtime directly is also what
# retires the old `--profile run --exit-code-from waggle` workaround — the
# Docker Compose behaviour that made it necessary (aborting the whole stack on
# the migrator's legitimate exit 0) has no equivalent here.
set -euo pipefail

cd "$(dirname "$0")/.."

DATABASE_URL="postgres://waggle:waggle@postgres.waggle:5432/waggle"
BROWSERHIVE_SERVER="http://browserhive.waggle:8080"
HEALTH_URL="http://localhost:8080/v1/status"
HEALTH_TIMEOUT_S="${BROWSERHIVE_HEALTHCHECK_TIMEOUT_S:-180}"
TEAR_DOWN_ON_EXIT="${TEAR_DOWN_ON_EXIT:-1}"

log() { echo "[$(date +%H:%M:%S)] $*"; }

teardown() {
  if [[ "${TEAR_DOWN_ON_EXIT}" == "1" ]]; then
    log "Tearing the stack down..."
    container-compose down >/dev/null 2>&1 || true
  else
    log "TEAR_DOWN_ON_EXIT=0 — leaving the stack up for inspection."
  fi
}
trap teardown EXIT

log "Starting the stack..."
container-compose up -d -b

# container-compose has no healthcheck support, so readiness is ours to check.
log "Waiting for BrowserHive (up to ${HEALTH_TIMEOUT_S}s)..."
deadline=$((SECONDS + HEALTH_TIMEOUT_S))
until curl -sf "${HEALTH_URL}" >/dev/null; do
  if (( SECONDS >= deadline )); then
    log "ERROR: BrowserHive never answered at ${HEALTH_URL}"
    exit 1
  fi
  sleep 1
done
log "BrowserHive is ready."

log "Building the waggle image..."
container build -t waggle:latest .

# The image's ENTRYPOINT is `node dist/cli.js`, so the db jobs have to override
# it; the capture just passes flags straight through.
run_job() {
  local label="$1"; shift
  log "Running ${label}..."
  container run --rm --entrypoint node \
    -e "DATABASE_URL=${DATABASE_URL}" \
    -e "BROWSERHIVE_SERVER=${BROWSERHIVE_SERVER}" \
    -e "LOG_LEVEL=${LOG_LEVEL:-info}" \
    waggle:latest "$@"
}

run_job "migrations" dist/db/migrate.js up
run_job "seed" dist/db/seed.js up

log "Running the capture..."
set +e
container run --rm \
  -e "DATABASE_URL=${DATABASE_URL}" \
  -e "BROWSERHIVE_SERVER=${BROWSERHIVE_SERVER}" \
  -e "LOG_LEVEL=${LOG_LEVEL:-info}" \
  waggle:latest --webp --limit 3
WAGGLE_EXIT=$?
set -e

log "All done. waggle exit code: ${WAGGLE_EXIT}"
exit "${WAGGLE_EXIT}"
