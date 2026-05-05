# Development

## Prerequisites

- Node.js 22 (the version in `.nvmrc`). `nvm use` if you have nvm installed.
- npm 10+ (ships with Node 22).
- Docker 25+ with BuildKit. Required for the Compose stacks but not for host-only development.
- A BrowserHive instance reachable at `BROWSERHIVE_SERVER` for end-to-end runs. The Compose stacks bring one up; otherwise you can point at a remote.

## First-time setup

```sh
git clone https://github.com/<you>/waggle.git
cd waggle
nvm use
npm ci
./setup.sh                 # generate .env from host info (safe to re-run)
npm run check              # typecheck + lint + format:check + tests
```

## Daily commands

| Command                           | What it does                                                          |
| --------------------------------- | --------------------------------------------------------------------- |
| `npm run dev -- <args>`           | Run the CLI from source via tsx (no build step).                      |
| `npm run build`                   | Emit JS/d.ts to `dist/` using `tsconfig.build.json`.                  |
| `npm run typecheck`               | `tsc --noEmit`. Includes test files and `*.config.ts`.                |
| `npm run lint` / `lint:fix`       | ESLint flat config (typescript-eslint recommendedTypeChecked).        |
| `npm run format` / `format:check` | Prettier; `.prettierignore` skips `dist/` and `src/http/generated/`.  |
| `npm test` / `test:watch`         | Vitest unit tests under `test/`.                                      |
| `npm run check`                   | Combined typecheck + lint + format:check + test (run before pushing). |
| `npm run openapi:generate`        | Regenerate `src/http/generated/` from `openapi/browserhive.yaml`.     |
| `npm run openapi:check`           | Generate then verify `git diff --exit-code` (CI drift gate).          |
| `npm run openapi:sync`            | Pull the latest `openapi.yaml` from upstream BrowserHive's `main`.    |

## Working against the Compose stack

Bring up everything except the one-shot waggle client:

```sh
docker compose -f compose.dev.yaml up --build -d \
  chromium-server-1 chromium-server-2 browserhive
```

Watch the rendering Chromium tabs at `http://localhost:6080/` and `http://localhost:6081/`.

Fire an ad-hoc capture run from the bundled sample data:

```sh
docker compose -f compose.dev.yaml run --rm waggle \
  --data data/sample.yaml --jpeg --html --limit 5
```

Or smoke-test the full chain in a single command (waggle runs once and exits, infra stays up):

```sh
docker compose -f compose.dev.yaml --profile run up --build
```

## Working against an external BrowserHive

If your BrowserHive runs elsewhere, point waggle at it directly:

```sh
BROWSERHIVE_SERVER=https://browserhive.example/ \
  npm run dev -- --data data/sample.yaml --jpeg --limit 3
```

For TLS with a custom CA, set `NODE_EXTRA_CA_CERTS` to the CA certificate file path before invoking the CLI. The `--tls-ca-cert` flag is logged for visibility but does not change Node's trust store on its own — the env var is the authoritative knob.

## Refreshing the OpenAPI vendor copy

When upstream BrowserHive changes the spec:

```sh
npm run openapi:sync       # overwrites openapi/browserhive.yaml from main
npm run openapi:generate   # regenerates src/http/generated/
npm run typecheck          # check the new types are still consistent
git add openapi/ src/http/generated/
git commit -m "Refresh OpenAPI vendor copy"
```

CI (`openapi:check`) fails any PR where `src/http/generated/` is out of sync with `openapi/browserhive.yaml`.

## Troubleshooting

- **`docker compose up` fails with "context not found"** — the Git build context format requires Docker BuildKit. Newer Docker Desktop and Docker Engine ≥ 23 ship BuildKit by default; on older Engines run `DOCKER_BUILDKIT=1 docker compose ...`.
- **chromium-server containers stuck in `starting` state** — open `http://localhost:6080/` in a browser; if the noVNC page does not load the build hasn't finished or the start scripts have crashed. `docker compose logs chromium-server-1` shows the supervisord output.
- **`fetch failed` from waggle** — BrowserHive isn't reachable. Check `docker compose ps` (the browserhive service should be `Up (healthy)`), then `curl http://localhost:8080/v1/status` to confirm.
- **eslint complains "file was not found by the project service"** — your new file is not covered by `tsconfig.json#include`. Either move it under `src/`, `test/`, or add it to the `include` list.
- **prettier reformats `src/http/generated/` files** — `.prettierignore` should be excluding them; check it hasn't been deleted.
- **My edits to `.env` got wiped on the next `./setup.sh`** — Expected: `setup.sh` always regenerates `.env` from host detection. Put persistent overrides in your shell environment (e.g. `export TZ=...` in your shell rc) before running `./setup.sh`.

## Repo conventions

- All relative imports use `.js` extensions (NodeNext + ESM). TypeScript-style `import type { … }` is required (`verbatimModuleSyntax: true`).
- Generated code (`src/http/generated/`) is **committed**. Do not gitignore it — the drift gate depends on it.
- Architectural decisions go under `docs/adr/`. Use `0000-template.md` as the starting point.
