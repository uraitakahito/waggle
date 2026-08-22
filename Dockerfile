# syntax=docker/dockerfile:1.7
#
# Production image for the waggle CLI.
#
# Build:
#   container build -t waggle:latest .
#
# Run (one-shot capture against an existing BrowserHive). The URLs come from
# Postgres, so both addresses have to be given:
#   container run --rm \
#     -e DATABASE_URL=postgres://waggle:waggle@postgres.waggle:5432/waggle \
#     -e BROWSERHIVE_SERVER=browserhive.waggle:50051 \
#     waggle:latest --wacz --limit 1
#
# The migration and seed jobs share this image but not its ENTRYPOINT — see
# `run_job` in scripts/prod-smoke.sh, which drives the whole stack end to end.

ARG NODE_VERSION=24.15.0

# ---------- Deps stage (production dependencies only) ----------
#
# A stage of its own, rather than pruning in place at the end of the builder.
# Two ways that look shorter and are not:
#
#   pnpm deploy --prod   — `deploy` picks one project out of a workspace, and
#                          this repo declares no `packages:`, so there is
#                          nothing to pick: ERR_PNPM_NOTHING_TO_DEPLOY.
#   pnpm install --prod  — in place at the end of the builder. The install
#     (in the builder)     itself finishes in under a second, but committing
#                          that layer hangs silently for tens of minutes: it
#                          rewrites a node_modules that held every dev
#                          dependency. It never errors, so it does not even
#                          look like a failure.
#
# An empty base with only prod dependencies keeps the layer small.
#
# --node-linker=hoisted is REQUIRED. pnpm's default links into a content
# addressable store, and there is no store in the runtime stage — the symlinks
# would dangle.
FROM node:${NODE_VERSION}-bookworm-slim AS deps

WORKDIR /deps

COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
RUN corepack enable && corepack prepare --activate
RUN pnpm install --prod --frozen-lockfile --node-linker=hoisted

# ---------- Builder stage ----------
FROM node:${NODE_VERSION}-bookworm-slim AS builder

WORKDIR /app

COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
RUN corepack enable && corepack prepare --activate
RUN pnpm install --frozen-lockfile

COPY tsconfig.json tsconfig.build.json ./
COPY src/ ./src/

# No prune here — the deps stage owns the production tree.
RUN pnpm run build

# ---------- Runtime stage ----------
FROM node:${NODE_VERSION}-bookworm-slim AS runtime

WORKDIR /app

ENV NODE_ENV=production

COPY --from=deps /deps/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY package.json ./

USER node

ENTRYPOINT ["node", "dist/submit-captures.js"]
