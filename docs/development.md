# Development

## Prerequisites

- Node.js 24 (the version in `.nvmrc`). `nvm use` if you have nvm installed.
- npm 11+ (ships with Node 24).
- Docker 25+ with BuildKit. Required for the Compose stacks but not for host-only development.
- `curl` on PATH — `setup.sh` uses it to download `Dockerfile.dev` and `docker-entrypoint.sh` from the pinned `uraitakahito/hello-javascript` template tag.
- A BrowserHive instance (≥ `1.3.0`) reachable at `BROWSERHIVE_SERVER` and a Postgres reachable at `DATABASE_URL` for end-to-end runs. The Compose stacks bring both up (plus a self-hosted SeaweedFS for capture artefact storage); otherwise you can point at remotes. waggle is pinned to a specific BrowserHive tag — see [Upgrading BrowserHive](#upgrading-browserhive).

## First-time setup

```sh
git clone https://github.com/<you>/waggle.git
cd waggle
nvm use
npm ci
./setup.sh                 # generate .env, download Dockerfile.dev + docker-entrypoint.sh
npm run check              # typecheck + lint + format:check + tests
```

`./setup.sh` is mandatory before any `docker compose -f compose.dev.yaml ...` invocation — `Dockerfile.dev`, `docker-entrypoint.sh`, and `etc/seaweedfs/{entrypoint.sh,init-bucket.sh,s3.template.json}` are gitignored and only exist after the script runs (the seaweedfs config files are downloaded from the pinned BrowserHive tag and mounted into the `seaweedfs` / `seaweedfs-init` services).

## Daily commands

| Command                                  | What it does                                                                 |
| ---------------------------------------- | ---------------------------------------------------------------------------- |
| `npm run dev -- <args>`                  | Build then run the CLI (`tsc` followed by `node dist/cli.js`).               |
| `npm run build`                          | Emit JS/d.ts to `dist/` using `tsconfig.build.json`.                         |
| `npm run typecheck`                      | `tsc --noEmit`. Includes test files and `*.config.ts`.                       |
| `npm run lint` / `lint:fix`              | ESLint flat config (typescript-eslint recommendedTypeChecked).               |
| `npm run format` / `format:check`        | Prettier; `.prettierignore` skips `dist/` and `src/http/generated/`.         |
| `npm test` / `test:watch`                | Vitest unit tests under `test/`.                                             |
| `npm run check`                          | Combined typecheck + lint + format:check + test (run before pushing).        |
| `npm run db:migrate` / `db:migrate:down` | Build then run Kysely migrations (`up` / `down`) against `DATABASE_URL`.     |
| `npm run db:seed` / `db:seed:down`       | Build then run Kysely seeds (`up` / `down`) — fixture under `src/db/seeds/`. |
| `npm run openapi:generate`               | Regenerate `src/http/generated/` from `openapi/browserhive.yaml`.            |
| `npm run openapi:check`                  | Generate then verify `git diff --exit-code` (CI drift gate).                 |
| `npm run openapi:sync`                   | Pull the latest `openapi.yaml` from upstream BrowserHive's `main`.           |

## Working against the Compose stack

The dev waggle service is a long-running shell container (built from the downloaded `Dockerfile.dev`, idle on `tail -F /dev/null`). Bring everything up:

```sh
docker compose -f compose.dev.yaml up --build -d
```

Watch the rendering Chromium tabs at `http://localhost:6080/` and `http://localhost:6081/`.

Drop into the container's interactive `zsh` — `.zshrc` sources nvm so `node` / `npm` resolve to the version baked into the dev image by the `hello-javascript` template (Node 24.14.1):

```sh
docker compose -f compose.dev.yaml exec waggle zsh
```

The dev image does not bundle waggle's `node_modules`; install once on the first session, then apply migrations and seed before firing capture runs:

```sh
# inside the container shell:
npm ci                        # first time only
npm run db:migrate            # first time / when schema changes
npm run db:seed               # populate urls with the bundled fixture
npm run dev -- --webp --html --limit 5
```

`DATABASE_URL` is wired by `compose.dev.yaml` to the in-stack `postgres` service.

For one-liner invocations from outside the container, `zsh -ic` is needed so the rc files load nvm:

```sh
docker compose -f compose.dev.yaml exec -T waggle \
  zsh -ic 'cd /app && npm run dev -- --webp --limit 1'
```

To smoke-test the **production** image end-to-end (build `Dockerfile.prod`, apply migrations, seed sample data, fire one capture, exit):

```sh
docker compose -f compose.prod.yaml --profile run up --build --exit-code-from waggle
```

`waggle-migrator` and `waggle-seeder` are dependencies of `waggle` in the run profile, so the schema is created and the fixture is loaded before the CLI queries `urls`. `seaweedfs-init` (a one-shot bucket bootstrap, profile-less) runs before `browserhive` so the configured S3 bucket exists by the time the first capture is uploaded. `--exit-code-from waggle` tears everything down once `waggle` exits and forwards `waggle`'s exit code as the compose exit code. (Plain `--abort-on-container-exit` is incompatible here — it aborts on the first one-shot's successful exit before downstream services have a chance to run.)

## Working against external Postgres / BrowserHive

If your BrowserHive and/or Postgres run elsewhere, point waggle at them directly:

```sh
DATABASE_URL=postgres://user:pass@db.host:5432/waggle \
BROWSERHIVE_SERVER=https://browserhive.example/ \
  npm run db:migrate
DATABASE_URL=postgres://user:pass@db.host:5432/waggle \
BROWSERHIVE_SERVER=https://browserhive.example/ \
  npm run dev -- --webp --limit 3
```

For TLS with a custom CA, set `NODE_EXTRA_CA_CERTS` to the CA certificate file path before invoking the CLI. The `--tls-ca-cert` flag is logged for visibility but does not change Node's trust store on its own — the env var is the authoritative knob.

For Postgres TLS, encode the relevant parameters in `DATABASE_URL` (e.g. `?sslmode=require`).

## Migrations

Migration files live under `src/db/migrations/<NNN>-<description>.ts` and export `up(db: Kysely<unknown>)` / `down(db: Kysely<unknown>)`. The runner (`src/db/migrate.ts`) is a thin wrapper around Kysely's `Migrator` + `FileMigrationProvider`; it tracks applied IDs in the `kysely_migration` ledger (with `kysely_migration_lock` guarding concurrent runs), so re-running `npm run db:migrate` is a no-op once everything is current. `npm run db:migrate:down` reverts the last applied migration.

To add a new migration:

1. Pick the next ordinal (e.g. `002-add-priority.ts`).
2. Implement `up` and `down` using the schema builder (`db.schema.alterTable(...)`, `db.schema.createIndex(...)`) or `sql\`...\`.execute(db)`for things the builder does not cover (extensions, generated columns,`CHECK` expressions referencing other columns).
3. Round-trip locally: `DATABASE_URL=... npm run db:migrate && npm run db:migrate:down && npm run db:migrate`.
4. Commit both the migration file and any related app changes in the same PR.

Seeds follow the same shape under `src/db/seeds/`, but use a separate `kysely_seed` ledger so they can be tracked independently.

## Refreshing the OpenAPI vendor copy

waggle is locked to a specific BrowserHive tag (currently `1.3.0`). `npm run openapi:sync` curls `openapi.yaml` from that tag, **not** from `main`. To refresh from the same tag (no version change):

```sh
npm run openapi:sync       # overwrites openapi/browserhive.yaml from the pinned tag
npm run openapi:generate   # regenerates src/http/generated/
npm run typecheck          # check the new types are still consistent
git add openapi/ src/http/generated/
git commit -m "Refresh OpenAPI vendor copy"
```

CI (`openapi:check`) fails any PR where `src/http/generated/` is out of sync with `openapi/browserhive.yaml`.

To bump the pinned tag itself, see [Upgrading BrowserHive](#upgrading-browserhive).

## Upgrading BrowserHive

The pinned tag drives **four** files in lock-step. A bump is a single PR that updates all four:

1. `package.json` — `openapi:sync` URL (the `refs/tags/<NEW>` segment).
2. `setup.sh` — the `BROWSERHIVE_VERSION` constant near the top. This drives both the `etc/seaweedfs/*` download and the `BROWSERHIVE_REF` line written to `.env`.
3. `compose.dev.yaml` — `${BROWSERHIVE_REF:-<NEW>}` default in the `browserhive` service.
4. `compose.prod.yaml` — same `${BROWSERHIVE_REF:-<NEW>}` default.

After editing those four:

```sh
npm run openapi:sync          # pulls openapi.yaml from the new tag
npm run openapi:generate      # regenerates src/http/generated/
npm run check                 # typecheck + lint + format:check + tests

./setup.sh                    # regenerates .env and re-downloads etc/seaweedfs/*

# Wipe old containers and volumes (artefact bucket, postgres data) so
# the next `up` rebuilds from the new tag against a clean state.
docker compose -f compose.dev.yaml down -v --remove-orphans
docker compose -f compose.dev.yaml up --build -d
```

If the new tag carries breaking changes to `CaptureFormats` or other request fields, expect typecheck failures in `src/types/capture.ts` / `src/config/cli-options.ts` / `src/client/submit.ts`; follow them through and update the matching tests under `test/`.

The bundled SeaweedFS bucket is name-stable across upgrades (`browserhive` by default), but its on-disk format is tied to the SeaweedFS image tag in `compose.{dev,prod}.yaml`, **not** to BrowserHive. A BrowserHive bump alone does not require wiping `waggle-seaweedfs-data*`.

## Troubleshooting

- **`docker compose -f compose.dev.yaml up` fails with `Dockerfile.dev: not found`** — the dev image is downloaded by `./setup.sh`, not committed. Run `./setup.sh` before any `compose.dev.yaml` invocation.
- **`seaweedfs` container fails to start with `entrypoint.sh: not found` or the `etc/seaweedfs/` bind mount is empty** — same root cause: `./setup.sh` has not been run since the last clean checkout, so the seaweedfs config files (downloaded from the pinned BrowserHive tag) do not exist. Run `./setup.sh`.
- **`browserhive` exits at startup with `BROWSERHIVE_S3_*` errors** — the four S3 env vars (`BROWSERHIVE_S3_ENDPOINT/BUCKET/ACCESS_KEY_ID/SECRET_ACCESS_KEY`) must reach the container. They are set by `compose.{dev,prod}.yaml` from `.env` / shell env. If you bypass compose, supply them on the `docker run -e ...` line.
- **Host `npm run check` fails with `MODULE_NOT_FOUND` for `@rollup/rollup-darwin-arm64` (or similar)** — the dev container bind-mounts `.:/app`, so a `npm ci` run _inside_ the container overwrites your host's `node_modules` with Linux-arm64 binaries. Run `npm ci` on the host to restore the native bindings, then choose one side (host or container) for npm operations rather than alternating.
- **`docker compose up` fails with "context not found"** — the Git build context format requires Docker BuildKit. Newer Docker Desktop and Docker Engine ≥ 23 ship BuildKit by default; on older Engines run `DOCKER_BUILDKIT=1 docker compose ...`.
- **chromium-server containers stuck in `starting` state** — open `http://localhost:6080/` in a browser; if the noVNC page does not load the build hasn't finished or the start scripts have crashed. `docker compose logs chromium-server-1` shows the supervisord output.
- **`fetch failed` from waggle** — BrowserHive isn't reachable. Check `docker compose ps` (the browserhive service should be `Up (healthy)`), then `curl http://localhost:8080/v1/status` to confirm.
- **`DATABASE_URL is not set` from `db:migrate` / `db:seed`** — the env var must be exported before invoking the runner. Inside the dev container it's set by Compose; on the host you must set it yourself.
- **`relation "urls" does not exist` from `npm run dev`** — migrations haven't been applied yet. Run `npm run db:migrate` first.
- **No URLs to process / "No entries to process"** — `urls` is empty (or all rows have `enabled = FALSE`). Run `npm run db:seed` for the fixture, or insert your own rows.
- **eslint complains "file was not found by the project service"** — your new file is not covered by `tsconfig.json#include`. Either move it under `src/`, `test/`, or add it to the `include` list.
- **prettier reformats `src/http/generated/` files** — `.prettierignore` should be excluding them; check it hasn't been deleted.
- **My edits to `.env` got wiped on the next `./setup.sh`** — Expected: `setup.sh` always regenerates `.env` from host detection. Put persistent overrides in your shell environment (e.g. `export TZ=...` in your shell rc) before running `./setup.sh`.

## Repo conventions

- All relative imports use `.js` extensions (NodeNext + ESM). TypeScript-style `import type { … }` is required (`verbatimModuleSyntax: true`).
- Generated code (`src/http/generated/`) is **committed**. Do not gitignore it — the drift gate depends on it.
- DB migrations are append-only: never edit a committed file under `src/db/migrations/`. Add a new ordinal instead.
