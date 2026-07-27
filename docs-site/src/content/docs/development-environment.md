---
title: Development environment
description: Prerequisites, daily commands, running without Compose, and troubleshooting.
---

## Prerequisites

- **Node.js 24** (the version in `.nvmrc`). `nvm use` if you have nvm.
- **npm 11+** — ships with Node 24.
- **Docker 25+ with BuildKit** — required for the Compose stacks, not for
  host-only development.
- **`curl`** on PATH — `setup.sh` uses it.
- A **BrowserHive** reachable at `BROWSERHIVE_SERVER` and a **Postgres** at
  `DATABASE_URL` for end-to-end runs. The Compose stacks bring both up; see
  [Upgrading BrowserHive](/waggle/upgrading-browserhive/) for the pinned version.

## First-time setup

```sh
git clone https://github.com/<you>/waggle.git
cd waggle
nvm use
npm ci
./setup.sh          # .env, Dockerfile.dev, docker-entrypoint.sh, etc/seaweedfs/*
npm run check       # typecheck + lint + format:check + tests
```

`setup.sh` is mandatory before any `docker compose` invocation: the files it
downloads are gitignored and only exist afterwards.

## Daily commands

| Command                                  | What it does                                                         |
| ---------------------------------------- | -------------------------------------------------------------------- |
| `npm run dev -- <args>`                  | Build, then run the CLI (`tsc` then `node dist/cli.js`).             |
| `npm run build`                          | Emit JS/d.ts to `dist/` via `tsconfig.build.json`.                   |
| `npm run typecheck`                      | `tsc --noEmit`, including tests and `*.config.ts`.                   |
| `npm run lint` / `lint:fix`              | ESLint flat config (typescript-eslint recommendedTypeChecked).       |
| `npm run format` / `format:check`        | Prettier. `.prettierignore` skips `dist/` and `src/http/generated/`. |
| `npm test` / `test:watch`                | Vitest unit tests under `test/`.                                     |
| `npm run check`                          | typecheck + lint + format:check + test. Run before pushing.          |
| `npm run db:migrate` / `db:migrate:down` | Kysely migrations against `DATABASE_URL`.                            |
| `npm run db:seed` / `db:seed:down`       | Kysely seeds from `src/db/seeds/`.                                   |
| `npm run openapi:generate`               | Regenerate `src/http/generated/` from the vendored spec.             |
| `npm run openapi:check`                  | Generate, then `git diff --exit-code` (CI drift gate).               |
| `npm run openapi:sync`                   | Re-download the spec from the pinned tag.                            |
| `npm run site:dev` / `site:build`        | This documentation site.                                             |
| `npm run site:check`                     | Build the site and verify its references.                            |

## Working against the Compose stack

The dev `waggle` service is a long-running shell container, idle on
`tail -F /dev/null`.

```sh
docker compose -f compose.dev.yaml up --build -d
docker compose -f compose.dev.yaml exec waggle zsh
```

Its `.zshrc` sources nvm, so `node` and `npm` resolve to the version baked into
the dev image. The image does not bundle `node_modules`; install once per
session, then migrate and seed before capturing.

:::caution
The repository is bind-mounted at `/app`, so `npm ci` inside the container
**overwrites the host's `node_modules` with Linux binaries**. Symptom on the
host afterwards: `Cannot find module @rollup/rollup-darwin-arm64`. Fix with
`rm -rf node_modules && npm ci` on the host.
:::

For one-liners from outside, `zsh -ic` is needed so the rc files load nvm:

```sh
docker compose -f compose.dev.yaml exec -T waggle \
  zsh -ic 'cd /app && npm run dev -- --webp --limit 1'
```

The Chromium workers are **headless**. To watch one render, open
`chrome://inspect` in a local Chrome, add `localhost:9222` and `localhost:9223`
under _Configure…_, and inspect the target. The DevTools screencast replaces the
noVNC image the upstream Chromium repository has retired.

## Production smoke test

```sh
./scripts/prod-smoke.sh
```

It brings the long-running services up detached, polls `/v1/status` until
BrowserHive is healthy, runs `waggle-migrator`, `waggle-seeder` and `waggle` in
sequence via `docker compose run --rm`, tears the stack down through an `EXIT`
trap, and forwards waggle's exit code as its own.

:::note[Why not `--profile run --exit-code-from waggle`?]
`--exit-code-from` implies `--abort-on-container-exit`, which in Docker Compose
v5.1.2 fires on the **first** container exit — including `waggle-migrator`'s
legitimate exit 0. That tears the stack down, SIGTERMs Postgres ~300 ms later,
and `waggle-seeder` then starts during teardown and dies with
`getaddrinfo ENOTFOUND postgres`. waggle itself never runs.
:::

The script builds the long-running services but **not** `waggle:latest`. After
changing waggle's own source, rebuild it explicitly or the smoke test will
exercise a stale image:

```sh
docker compose -f compose.prod.yaml build waggle
```

## Working against external Postgres / BrowserHive

```sh
DATABASE_URL=postgres://user:pass@db.host:5432/waggle \
BROWSERHIVE_SERVER=https://browserhive.example/ \
  npm run db:migrate

DATABASE_URL=postgres://user:pass@db.host:5432/waggle \
BROWSERHIVE_SERVER=https://browserhive.example/ \
  npm run dev -- --webp --limit 3
```

For TLS with a custom CA, set `NODE_EXTRA_CA_CERTS` to the CA file before
invoking the CLI — that env var is the authoritative knob; `--tls-ca-cert` is
logged for visibility but does not change Node's trust store on its own. For
Postgres TLS, encode the parameters in `DATABASE_URL` (e.g. `?sslmode=require`).

## Troubleshooting

- **`chromium-server` stuck in `starting`** — `curl http://localhost:9222/json/version`.
  If CDP does not answer, the build has not finished or the start scripts
  crashed; `docker compose logs chromium-server-1` shows supervisord's output.
- **BrowserHive exits at boot** — its startup `HeadBucket` is fatal. Check that
  `WAIT_FOR_S3` is set on the service and that SeaweedFS logged
  `Bucket browserhive ready.`
- **`Request rejected` with a `/…` path in the message** — that is BrowserHive's
  RFC 7807 `detail` naming the offending field. The request never became a task.
- **Host build fails with `@rollup/rollup-darwin-arm64`** — see the bind-mount
  caution above.

## Repo conventions

- Source under `src/`, tests under `test/`, one concern per module.
- `src/http/generated/` is generated and committed; never edit it by hand.
- Prettier and ESLint are authoritative — run `npm run check` before pushing.
- Documentation lives in `docs-site/`, in English and Japanese. Adding an
  English page without its Japanese counterpart fails `npm run site:check`.
