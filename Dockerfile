# syntax=docker/dockerfile:1.7

# ---------------------------------------------------------------------------
# Builder — install all deps, type-check, and emit dist/.
# ---------------------------------------------------------------------------
FROM node:22-bookworm-slim AS builder

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json tsconfig.build.json openapi-ts.config.ts ./
COPY openapi/ ./openapi/
COPY src/ ./src/

RUN npm run build \
 && npm prune --omit=dev

# ---------------------------------------------------------------------------
# Dev — used by compose.dev.yaml. Source is bind-mounted at runtime; the
# image only needs the toolchain (tsx, type definitions) installed.
# ---------------------------------------------------------------------------
FROM node:22-bookworm-slim AS dev

WORKDIR /app

ENV NODE_ENV=development

COPY package.json package-lock.json ./
RUN npm ci

# Copy the rest so the image is also runnable on its own (without a bind
# mount). compose.dev.yaml overlays /app with a host bind mount for live
# editing; an anonymous volume on /app/node_modules preserves the
# image-resident dependencies across that overlay.
COPY . .

ENTRYPOINT ["npx", "tsx", "src/cli.ts"]

# ---------------------------------------------------------------------------
# Runtime — minimal production image with only built artefacts and pruned
# dependencies.
# ---------------------------------------------------------------------------
FROM node:22-bookworm-slim AS runtime

WORKDIR /app

ENV NODE_ENV=production

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/openapi ./openapi
COPY package.json ./

USER node

ENTRYPOINT ["node", "dist/cli.js"]
