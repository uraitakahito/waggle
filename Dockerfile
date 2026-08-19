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

# ---------- Builder stage ----------
FROM node:${NODE_VERSION}-bookworm-slim AS builder

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json tsconfig.build.json ./
COPY src/ ./src/

RUN npm run build \
 && npm prune --omit=dev

# ---------- Runtime stage ----------
FROM node:${NODE_VERSION}-bookworm-slim AS runtime

WORKDIR /app

ENV NODE_ENV=production

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY package.json ./

USER node

ENTRYPOINT ["node", "dist/cli.js"]
