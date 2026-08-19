#!/bin/bash
#
# setup.sh — bootstrap waggle's local development environment.
#
# Everything upstream now arrives through the `.upstream/browserhive`
# submodule: BrowserHive itself, the chromium-server-docker it was tested
# against, and the SeaweedFS config the stack mounts. There is nothing to
# download — `container build` only accepts a context directory, so the source
# has to be on disk anyway, and one submodule pointer is the single upstream
# pin.
#
# What this does:
#   1. Checks the Apple Container toolchain is present.
#   2. Refuses to continue if the `waggle` DNS domain is not registered.
#   3. Initialises the submodules (the step everyone forgets).
#   4. Writes .env with the host-side connection strings.
#

set -e

cd "$(dirname "$0")"

if [[ "${1:-}" == "--help" || "${1:-}" == "-h" ]]; then
  sed -n '3,17p' "$0" | sed 's/^# \{0,1\}//'
  exit 0
fi

if [[ $# -gt 0 ]]; then
  echo "ERROR: unexpected argument: $1" >&2
  echo "Run '$0 --help' for usage." >&2
  exit 1
fi

# --- Toolchain ------------------------------------------------------------
for cmd in container container-compose git; do
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "ERROR: \`$cmd\` is required but not on PATH." >&2
    echo "Install Apple Container and container-compose (Homebrew), then re-run." >&2
    exit 1
  fi
done

# --- DNS domain -----------------------------------------------------------
# The project name in docker-compose.yml IS the DNS domain. Without it,
# container-compose falls back to patching /etc/hosts, which silently fails for
# the non-root containers in this stack (browserhive, chromium) — the failure
# mode is "names mysteriously do not resolve", so fail loudly here instead.
if ! container system dns ls 2>/dev/null | grep -qx "waggle"; then
  echo "ERROR: the 'waggle' DNS domain is not registered." >&2
  echo "" >&2
  echo "    sudo container system dns create waggle" >&2
  echo "" >&2
  echo "Run that once (it needs sudo), then re-run this script." >&2
  exit 1
fi

# --- Upstream submodule ---------------------------------------------------
echo "Initialising upstream submodule..."
git submodule update --init --recursive
git submodule status --recursive | sed 's/^/  /'

# --- Generate .env --------------------------------------------------------
# Only what the host side needs: waggle runs on the host and reaches the stack
# through the platform DNS. Service-to-service wiring lives in
# docker-compose.yml.
cat > .env <<EOF
DATABASE_URL=postgres://waggle:waggle@postgres.waggle:5432/waggle
BROWSERHIVE_SERVER=browserhive.waggle:50051
LOG_LEVEL=info
EOF
echo "Created .env"

cat <<'EOF'

Setup complete.

  container-compose up -d -b                  # build and start the stack
  until grpcurl -plaintext -import-path proto -proto browserhive/v1/capture.proto \
    localhost:50051 browserhive.v1.CaptureService/GetStatus >/dev/null 2>&1; do sleep 1; done

Then work on the host — there is no dev container; the stack is reachable by
name:

  npm ci
  npm run db:migrate && npm run db:seed
  npm run dev -- --webp --limit 3
EOF
