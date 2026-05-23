#!/usr/bin/env bash
# scripts/prod-smoke.sh
#
# Production stack end-to-end smoke test for the waggle prod stack.
#
# Why this script exists instead of a single
# `docker compose --profile run up --exit-code-from waggle` invocation:
#
#   `--exit-code-from` implies `--abort-on-container-exit`, which in
#   Docker Compose v5.1.2 fires on the FIRST container exit — including
#   `waggle-migrator`'s legitimate exit 0 after applying migrations.
#   That triggers a stack-wide teardown, SIGTERM-ing postgres ~300 ms
#   later. `waggle-seeder` (which depends on migrator's completion)
#   then starts and fails immediately with `getaddrinfo ENOTFOUND
#   postgres`, because Docker has already retired postgres from its
#   embedded DNS. waggle itself never gets to start.
#
# The fix below avoids `--abort-on-container-exit` entirely by:
#   1. Bringing core long-running services up with `up -d` (no abort).
#   2. Running each one-shot via `docker compose run --rm`, which
#      executes the service in the foreground and waits for its exit
#      without touching the rest of the stack.
#   3. Tearing the stack down explicitly at the end (via the EXIT
#      trap so failures still clean up).
#
# Usage:
#   ./scripts/prod-smoke.sh
#   exit code = waggle's exit code (the final one-shot)
#
# Overridable env vars:
#   COMPOSE_FILE                          (default: compose.prod.yaml)
#   BROWSERHIVE_HEALTHCHECK_TIMEOUT_S     (default: 120)
#   BROWSERHIVE_HOST_PORT                 (default: 8080)
#   TEAR_DOWN_ON_EXIT                     (default: 1; set 0 to keep stack on failure)

set -euo pipefail

COMPOSE_FILE="${COMPOSE_FILE:-compose.prod.yaml}"
BROWSERHIVE_HEALTHCHECK_TIMEOUT_S="${BROWSERHIVE_HEALTHCHECK_TIMEOUT_S:-120}"
BROWSERHIVE_HOST_PORT="${BROWSERHIVE_HOST_PORT:-8080}"
TEAR_DOWN_ON_EXIT="${TEAR_DOWN_ON_EXIT:-1}"

# shellcheck disable=SC2329  # invoked indirectly via `trap cleanup EXIT` below
cleanup() {
  if [ "${TEAR_DOWN_ON_EXIT}" = "1" ]; then
    docker compose -f "${COMPOSE_FILE}" down -v --remove-orphans >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

log() {
  echo "[$(date +%H:%M:%S)] $*" >&2
}

log "Bringing core services up (postgres / seaweedfs / chromium-server / browserhive)..."
docker compose -f "${COMPOSE_FILE}" up -d --build

log "Waiting for browserhive to become healthy (timeout ${BROWSERHIVE_HEALTHCHECK_TIMEOUT_S}s)..."
ELAPSED=0
INTERVAL=2
HEALTHY=0
while [ "${ELAPSED}" -lt "${BROWSERHIVE_HEALTHCHECK_TIMEOUT_S}" ]; do
  if curl -sf --max-time 3 "http://localhost:${BROWSERHIVE_HOST_PORT}/v1/status" >/dev/null 2>&1; then
    HEALTHY=1
    break
  fi
  sleep "${INTERVAL}"
  ELAPSED=$((ELAPSED + INTERVAL))
done
if [ "${HEALTHY}" != "1" ]; then
  log "ERROR: browserhive did not become healthy within ${BROWSERHIVE_HEALTHCHECK_TIMEOUT_S}s"
  docker compose -f "${COMPOSE_FILE}" ps
  docker compose -f "${COMPOSE_FILE}" logs browserhive | tail -40
  exit 2
fi
log "browserhive healthy after ${ELAPSED}s"

# --no-deps on each explicit one-shot run: the dependencies
# (postgres, browserhive, etc.) are already running from `up -d`
# above, so re-starting them — which compose otherwise does because
# `service_completed_successfully` deps re-spawn fresh one-shot
# containers — only adds latency. The sequential order below is the
# real correctness contract.
log "Running waggle-migrator..."
docker compose -f "${COMPOSE_FILE}" run --rm --no-deps waggle-migrator

log "Running waggle-seeder..."
docker compose -f "${COMPOSE_FILE}" run --rm --no-deps waggle-seeder

log "Running waggle (the actual capture)..."
# `docker compose run` exits non-zero if the service exits non-zero, and
# `set -e` would normally abort the script before we capture the exit
# code. Disable that temporarily so `WAGGLE_EXIT=$?` actually sees the
# real value, then re-enable.
set +e
docker compose -f "${COMPOSE_FILE}" run --rm --no-deps waggle
WAGGLE_EXIT=$?
set -e

log "All done. waggle exit code: ${WAGGLE_EXIT}"
exit "${WAGGLE_EXIT}"
