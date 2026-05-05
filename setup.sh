#!/bin/bash
#
# setup.sh — bootstrap waggle's local development environment.
#

set -e

# Pinned version of the shared developer-image template that ships
# `Dockerfile.dev` + `docker-entrypoint.sh`. BrowserHive uses the same
# repo; bump this independently when waggle wants a newer dev image.
HELLO_JAVASCRIPT_VERSION="1.2.7"
HELLO_JAVASCRIPT_BASE_URL="https://raw.githubusercontent.com/uraitakahito/hello-javascript/refs/tags/${HELLO_JAVASCRIPT_VERSION}"

usage() {
  cat <<'USAGE'
Usage: ./setup.sh [--help]

Bootstraps waggle's dev environment by:

  1. Downloading Dockerfile.dev + docker-entrypoint.sh from the pinned
     uraitakahito/hello-javascript template tag (both are gitignored).
  2. Regenerating .env at the repository root based on host info:

       USER_ID, GROUP_ID            detected via `id -u` / `id -g`
       TZ                           from $TZ if set, otherwise Asia/Tokyo
       BROWSERHIVE_REF              = main
       CHROMIUM_SERVER_REF          = main
       BROWSERHIVE_HOST_PORT        = 8080
       LOG_LEVEL, BROWSERHIVE_LOG_LEVEL = info
       POSTGRES_USER, POSTGRES_PASSWORD, POSTGRES_DB = waggle / waggle / waggle
       POSTGRES_HOST_PORT           = 5432

The script always regenerates .env and re-downloads the dev assets.
Persistent overrides should live in your shell environment, not in .env.

Options:
  -h, --help    Show this message and exit.
USAGE
}

if [[ "${1:-}" == "--help" || "${1:-}" == "-h" ]]; then
  usage
  exit 0
fi

if [[ $# -gt 0 ]]; then
  echo "ERROR: Unknown argument: $1" >&2
  echo "Run \`./setup.sh --help\` for usage." >&2
  exit 1
fi

echo "Starting waggle setup..."

# --- Prerequisite checks (warnings only) ---------------------------------
# Don't fail here: a host-Node-only workflow (npm run dev against a remote
# BrowserHive) doesn't need Docker.
if ! command -v docker >/dev/null 2>&1; then
  echo "WARNING: \`docker\` not found in PATH; you'll need it before \`docker compose ... up\`." >&2
elif ! docker compose version >/dev/null 2>&1; then
  echo "WARNING: \`docker compose\` plugin unavailable; install Docker Compose v2." >&2
fi

if ! command -v curl >/dev/null 2>&1; then
  echo "ERROR: \`curl\` is required to fetch the dev image template." >&2
  exit 1
fi

# --- Download Dockerfile.dev / docker-entrypoint.sh ----------------------
echo "Downloading Dockerfile.dev (hello-javascript ${HELLO_JAVASCRIPT_VERSION})..."
if ! curl -fL -o Dockerfile.dev "${HELLO_JAVASCRIPT_BASE_URL}/Dockerfile.dev"; then
  echo "ERROR: Failed to download Dockerfile.dev from:" >&2
  echo "  ${HELLO_JAVASCRIPT_BASE_URL}/Dockerfile.dev" >&2
  echo "Check network access and that the version tag exists." >&2
  exit 1
fi

echo "Downloading docker-entrypoint.sh (hello-javascript ${HELLO_JAVASCRIPT_VERSION})..."
if ! curl -fL -o docker-entrypoint.sh "${HELLO_JAVASCRIPT_BASE_URL}/docker-entrypoint.sh"; then
  echo "ERROR: Failed to download docker-entrypoint.sh from:" >&2
  echo "  ${HELLO_JAVASCRIPT_BASE_URL}/docker-entrypoint.sh" >&2
  echo "Check network access and that the version tag exists." >&2
  exit 1
fi
chmod 755 docker-entrypoint.sh

# --- Generate .env --------------------------------------------------------
cat > .env <<EOF
USER_ID=$(id -u)
GROUP_ID=$(id -g)
TZ=${TZ:-Asia/Tokyo}
BROWSERHIVE_REF=main
CHROMIUM_SERVER_REF=main
BROWSERHIVE_HOST_PORT=8080
LOG_LEVEL=info
BROWSERHIVE_LOG_LEVEL=info
POSTGRES_USER=waggle
POSTGRES_PASSWORD=waggle
POSTGRES_DB=waggle
POSTGRES_HOST_PORT=5432
EOF
echo "Created .env (regenerated from host info)"

echo ""
echo "Setup complete!"
echo ""
echo "Next steps:"
echo "  docker compose -f compose.dev.yaml up --build -d"
echo "  docker compose -f compose.dev.yaml exec waggle zsh -ic '"
echo "    cd /app && npm ci && npm run db:migrate && npm run db:seed'"
echo "  docker compose -f compose.dev.yaml exec waggle \\"
echo "    npm run dev -- --jpeg --html --limit 3"
