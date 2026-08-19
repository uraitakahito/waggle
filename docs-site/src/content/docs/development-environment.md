---
title: Development environment
description: Prerequisites, daily commands, running without Compose, and troubleshooting.
---

## Prerequisites

- **Node.js 24** (the version in `.nvmrc`). `nvm use` if you have nvm.
- **npm 11+** — ships with Node 24.
- **[Apple Container](https://github.com/apple/container)** and
  **container-compose** (both via Homebrew) — required for the stack, not for
  host-only development. macOS only.
- **`curl`** and **`git`** on PATH.
- A **BrowserHive** reachable at `BROWSERHIVE_SERVER` and a **Postgres** at
  `DATABASE_URL` for end-to-end runs. The Compose stacks bring both up; see
  [Upgrading BrowserHive](/waggle/upgrading-browserhive/) for the pinned version.

## First-time setup

```sh
git clone https://github.com/<you>/waggle.git
cd waggle
nvm use
npm ci
sudo container system dns create waggle   # once per machine
./setup.sh          # submodules + .env
npm run check       # typecheck + lint + format:check + tests
```

`setup.sh` is mandatory before any `container-compose` invocation: it
initialises the `.upstream/browserhive` submodule that every build context
points at, and refuses to continue if the `waggle` DNS domain is missing.

## Daily commands

| Command                                  | What it does                                                        |
| ---------------------------------------- | ------------------------------------------------------------------- |
| `npm run dev -- <args>`                  | Build, then run the CLI (`tsc` then `node dist/cli.js`).            |
| `npm run build`                          | Emit JS/d.ts to `dist/` via `tsconfig.build.json`.                  |
| `npm run typecheck`                      | `tsc --noEmit`, including tests and `*.config.ts`.                  |
| `npm run lint` / `lint:fix`              | ESLint flat config (typescript-eslint recommendedTypeChecked).      |
| `npm run format` / `format:check`        | Prettier. `.prettierignore` skips `dist/` and `src/rpc/generated/`. |
| `npm test` / `test:watch`                | Vitest unit tests under `test/`.                                    |
| `npm run check`                          | typecheck + lint + format:check + test. Run before pushing.         |
| `npm run db:migrate` / `db:migrate:down` | Kysely migrations against `DATABASE_URL`.                           |
| `npm run db:seed` / `db:seed:down`       | Kysely seeds from `src/db/seeds/`.                                  |
| `npm run proto:generate`                 | Regenerate `src/rpc/generated/` from the vendored `.proto` (buf).   |
| `npm run proto:check`                    | Generate, then `git diff --exit-code` (CI drift gate).              |
| `npm run proto:sync`                     | Re-copy the `.proto` from the pinned submodule.                     |
| `npm run site:dev` / `site:build`        | This documentation site.                                            |
| `npm run site:check`                     | Build the site and verify its references.                           |

## Working against the stack

```sh
container-compose up -d -b
# grpcurl reads the vendored contract; GetStatus is the readiness probe.
until grpcurl -plaintext -import-path proto -proto browserhive/v1/capture.proto \
  localhost:50051 browserhive.v1.CaptureService/GetStatus >/dev/null 2>&1; do sleep 1; done
```

**There is no dev container.** container-compose has exactly four subcommands —
`up`, `down`, `build`, `version` — so there is no `exec` to drop into. It does
not need one: the platform DNS resolves `<service>.waggle` from the host as well
as between containers, so waggle runs on the host against the containerised
stack. `setup.sh` writes the two connection strings into `.env`:

```sh
DATABASE_URL=postgres://waggle:waggle@postgres.waggle:5432/waggle
BROWSERHIVE_SERVER=browserhive.waggle:50051
```

Postgres is also published on `127.0.0.1:5432`, so `localhost` works too.

Coming from Docker Compose, the everyday commands map like this:

| Docker Compose                    | Apple Container                      |
| --------------------------------- | ------------------------------------ |
| `docker compose up -d --build`    | `container-compose up -d -b`         |
| `docker compose down`             | `container-compose down`             |
| `docker compose ps`               | `container ls`                       |
| `docker compose logs browserhive` | `container logs browserhive.waggle`  |
| `docker compose exec <svc> sh`    | `container exec -it <svc>.waggle sh` |
| `docker compose run --rm <svc> …` | `container run --rm <image> …`       |

The Chromium workers are **headless**. To watch one render, open
`chrome://inspect` in a local Chrome, add `localhost:9222` and `localhost:9223`
under _Configure…_, and inspect the target.

## Production smoke test

```sh
./scripts/prod-smoke.sh
```

It brings the stack up, polls `/v1/status` until BrowserHive answers, builds
`waggle:latest`, then runs migrate → seed → one capture with
`container run --rm`, tears the stack down through an `EXIT` trap, and forwards
waggle's exit code as its own.

The one-shot jobs are plain `container run` calls because container-compose has
no `run` subcommand. That also retires the old
`--profile run --exit-code-from waggle` workaround: the Docker Compose behaviour
it worked around — aborting the whole stack on the migrator's legitimate exit 0
— has no equivalent here.

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

- **A container will not come up** — `container ls` shows what is running and
  `container logs <svc>.waggle` shows why. For Chromium,
  `curl http://localhost:9222/json/version` tells you whether CDP is answering.
- **Names do not resolve** — check that `container system dns ls` lists
  `waggle`, and that no service in `docker-compose.yml` has a `container_name:`
  key (it suppresses the DNS naming).
- **BrowserHive exits at boot** — its startup `HeadBucket` is fatal. Check that
  `WAIT_FOR_S3` is set on the service and that SeaweedFS logged
  `Bucket browserhive ready.`
- **`Request rejected` with a `/…` path in the message** — that is BrowserHive's
  RFC 7807 `detail` naming the offending field. The request never became a task.
- **The docs build cannot read the BrowserHive pin** — run
  `git submodule update --init --recursive`.

## Repo conventions

- Source under `src/`, tests under `test/`, one concern per module.
- `src/rpc/generated/` is generated and committed; never edit it by hand.
- Prettier and ESLint are authoritative — run `npm run check` before pushing.
- Documentation lives in `docs-site/`, in English and Japanese. Adding an
  English page without its Japanese counterpart fails `npm run site:check`.
