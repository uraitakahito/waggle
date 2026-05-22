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

# Pinned BrowserHive version. The OpenAPI spec under `openapi/` and the
# generated SDK under `src/http/generated/` are tied to this tag, and the
# `seaweedfs` / `seaweedfs-init` services in compose mount config files
# downloaded from the same tag (so all three move together on bump).
# When bumping: update `package.json#openapi:sync` URL, this constant,
# the `BROWSERHIVE_REF` default in compose.{dev,prod}.yaml, then run
# `npm run openapi:sync && npm run openapi:generate && ./setup.sh`.
BROWSERHIVE_VERSION="1.5.1"
BROWSERHIVE_BASE_URL="https://raw.githubusercontent.com/uraitakahito/browserhive/refs/tags/${BROWSERHIVE_VERSION}"

usage() {
  cat <<'USAGE'
Usage: ./setup.sh [--help]

Bootstraps waggle's dev environment by:

  1. Downloading Dockerfile.dev + docker-entrypoint.sh from the pinned
     uraitakahito/hello-javascript template tag (both are gitignored).
  2. Downloading etc/seaweedfs/{entrypoint.sh,init-bucket.sh,s3.template.json}
     from the pinned uraitakahito/browserhive tag (gitignored). These
     are mounted into the seaweedfs / seaweedfs-init services by the
     compose stacks.
  3. Regenerating .env at the repository root based on host info:

       USER_ID, GROUP_ID                                detected via `id -u` / `id -g`
       TZ                                               from $TZ if set, otherwise Asia/Tokyo
       BROWSERHIVE_REF                                  = 1.5.1
       CHROMIUM_SERVER_REF                              = main
       BROWSERHIVE_HOST_PORT                            = 8080
       LOG_LEVEL, BROWSERHIVE_LOG_LEVEL                 = info
       BROWSERHIVE_S3_REGION                            = us-east-1
       BROWSERHIVE_S3_BUCKET                            = browserhive
       BROWSERHIVE_S3_ACCESS_KEY_ID, _SECRET_ACCESS_KEY = browserhive (dev defaults)
       POSTGRES_USER, POSTGRES_PASSWORD, POSTGRES_DB    = waggle / waggle / waggle
       POSTGRES_HOST_PORT                               = 5432

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

# --- Download etc/seaweedfs/* (BrowserHive ${BROWSERHIVE_VERSION}) -------
mkdir -p etc/seaweedfs
for f in entrypoint.sh init-bucket.sh s3.template.json; do
  echo "Downloading etc/seaweedfs/${f} (browserhive ${BROWSERHIVE_VERSION})..."
  if ! curl -fL -o "etc/seaweedfs/${f}" "${BROWSERHIVE_BASE_URL}/etc/seaweedfs/${f}"; then
    echo "ERROR: Failed to download etc/seaweedfs/${f} from:" >&2
    echo "  ${BROWSERHIVE_BASE_URL}/etc/seaweedfs/${f}" >&2
    echo "Check network access and that the version tag exists." >&2
    exit 1
  fi
done
chmod 755 etc/seaweedfs/entrypoint.sh etc/seaweedfs/init-bucket.sh

# --- Generate .env --------------------------------------------------------
cat > .env <<EOF
USER_ID=$(id -u)
GROUP_ID=$(id -g)
TZ=${TZ:-Asia/Tokyo}
BROWSERHIVE_REF=${BROWSERHIVE_VERSION}
CHROMIUM_SERVER_REF=main
BROWSERHIVE_HOST_PORT=8080
LOG_LEVEL=info
BROWSERHIVE_LOG_LEVEL=info
BROWSERHIVE_S3_REGION=us-east-1
BROWSERHIVE_S3_BUCKET=browserhive
BROWSERHIVE_S3_ACCESS_KEY_ID=browserhive
BROWSERHIVE_S3_SECRET_ACCESS_KEY=browserhive
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
echo "    npm run dev -- --webp --html --limit 3"
