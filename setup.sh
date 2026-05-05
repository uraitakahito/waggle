#!/bin/bash
#
# setup.sh — generate waggle's .env from host detection.
#
# Always regenerates .env. Persistent overrides should live in your shell
# environment (e.g. `export TZ=...` in ~/.zshrc) before running this
# script — anything edited inside .env will be lost on the next run.
#
# Secrets MUST NOT be persisted in .env. waggle currently has no secrets
# to manage; if that changes, prefer compose-time injection (env_file +
# host env vars) over checked-in defaults.

set -e

usage() {
  cat <<'USAGE'
Usage: ./setup.sh [--help]

Generates a fresh .env at the repository root based on host info:

  USER_ID, GROUP_ID            detected via `id -u` / `id -g`
  TZ                           from $TZ if set, otherwise Asia/Tokyo
  BROWSERHIVE_REF              = main
  CHROMIUM_SERVER_REF          = main
  BROWSERHIVE_HOST_PORT        = 8080
  LOG_LEVEL, BROWSERHIVE_LOG_LEVEL = info

The script always regenerates .env. Persistent overrides should live in
your shell environment, not in .env.

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
EOF
echo "Created .env (regenerated from host info)"

echo ""
echo "Setup complete!"
echo ""
echo "Next steps:"
echo "  docker compose -f compose.dev.yaml up --build -d \\"
echo "    chromium-server-1 chromium-server-2 browserhive"
echo "  docker compose -f compose.dev.yaml run --rm waggle \\"
echo "    --data data/sample.yaml --jpeg --html --limit 3"
