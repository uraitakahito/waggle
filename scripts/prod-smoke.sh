#!/usr/bin/env bash
#
# End-to-end smoke test of the production image against a real stack.
#
# Brings the stack up with container-compose, waits for BrowserHive to answer,
# then runs migrate → seed → the API from the freshly built waggle image, and
# tears everything down through an EXIT trap.
#
# **It no longer captures anything.** waggle does not speak gRPC to BrowserHive
# any more — the Windmill flow submits, and waggle plans and records. What this
# script proves is that the image boots: migrations apply, the seed lands, and
# the API answers. The capture path is covered end to end by capture-scheduler's
# `pnpm run test:e2e`, which needs Windmill as well.
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
HEALTH_TARGET="localhost:50051"
HEALTH_TIMEOUT_S="${BROWSERHIVE_HEALTHCHECK_TIMEOUT_S:-180}"

# The capture does not stop at "accepted": it polls GetCapture, reads the
# durable `.result.json` manifest when a result has aged out of BrowserHive's
# cache, and registers the archive in the ledger. All of that needs the bucket,
# so the S3 settings belong to the capture run and not just to BrowserHive.
# They match docker-compose.yml's seaweedfs service; path-style because the
# bundled SeaweedFS has no wildcard DNS for the bucket subdomain.
S3_ENV=(
  -e "WAGGLE_S3_ENDPOINT=http://seaweedfs.waggle:8333"
  -e "WAGGLE_S3_REGION=us-east-1"
  -e "WAGGLE_S3_BUCKET=browserhive"
  -e "WAGGLE_S3_ACCESS_KEY_ID=browserhive"
  -e "WAGGLE_S3_SECRET_ACCESS_KEY=browserhive"
  -e "WAGGLE_S3_FORCE_PATH_STYLE=true"
)
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

# Pass the submodule versions as build args. Without them the image calls itself
# "unknown", and that value is baked into every archive it produces. This script
# does not go through scripts/stack.sh, so it has to source the same helper —
# one place computes the answer, both entry points read it.
# shellcheck source=scripts/submodule-versions.sh
. "$(dirname "$0")/submodule-versions.sh"
export_submodule_versions

log "Starting the stack..."
container-compose up -d -b

# container-compose has no healthcheck support, so readiness is ours to check.
# BrowserHive serves no HTTP and no gRPC health service, so the probe is a real
# GetStatus call over the vendored contract — which is also the strongest
# readiness signal available: it only answers once the coordinator is up.
if ! command -v grpcurl >/dev/null 2>&1; then
  log "ERROR: grpcurl is required to probe BrowserHive (brew install grpcurl)"
  exit 1
fi
probe() {
  grpcurl -plaintext -import-path proto -proto browserhive/v1/capture.proto \
    "${HEALTH_TARGET}" browserhive.v1.CaptureService/GetStatus >/dev/null 2>&1
}
log "Waiting for BrowserHive (up to ${HEALTH_TIMEOUT_S}s)..."
deadline=$((SECONDS + HEALTH_TIMEOUT_S))
until probe; do
  if (( SECONDS >= deadline )); then
    log "ERROR: BrowserHive never answered at ${HEALTH_TARGET}"
    exit 1
  fi
  sleep 1
done
log "BrowserHive is ready."

log "Building the waggle image..."
container build -t waggle:latest .

# The image's ENTRYPOINT is `node dist/api/server.js`, so the db jobs have to
# override it.
run_job() {
  local label="$1"; shift
  log "Running ${label}..."
  container run --rm --entrypoint node \
    -e "DATABASE_URL=${DATABASE_URL}" \
    -e "LOG_LEVEL=${LOG_LEVEL:-info}" \
    waggle:latest "$@"
}

run_job "migrations" dist/db/migrate.js up
run_job "seed" dist/db/seed.js up

# The API is a server, not a job: run it detached, ask it one question, stop it.
# `/healthz` needs neither a token nor FGA, which is what makes it usable here.
log "Starting the API..."
API_ID=$(container run -d --rm \
  -e "DATABASE_URL=${DATABASE_URL}" \
  -e "LOG_LEVEL=${LOG_LEVEL:-info}" \
  -e "WAGGLE_API_HOST=0.0.0.0" \
  "${S3_ENV[@]}" \
  -p 7070:7070 \
  waggle:latest)
trap 'container stop "${API_ID}" >/dev/null 2>&1 || true' EXIT

log "Waiting for the API..."
WAGGLE_EXIT=1
for _ in $(seq 1 30); do
  if curl -fsS "http://localhost:7070/healthz" >/dev/null 2>&1; then
    WAGGLE_EXIT=0
    break
  fi
  sleep 2
done

if [ "${WAGGLE_EXIT}" -ne 0 ]; then
  log "The API did not answer /healthz. Recent output:"
  container logs "${API_ID}" 2>&1 | tail -40
fi

log "All done. waggle exit code: ${WAGGLE_EXIT}"
exit "${WAGGLE_EXIT}"
