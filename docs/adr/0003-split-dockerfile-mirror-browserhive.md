# ADR 0003: Split the Dockerfile and source the dev image from a shared template

- Status: Accepted
- Date: 2026-05-05
- Deciders: takaurai

## Context

Stage 0 shipped a single multi-stage `Dockerfile` at the repo root with three targets — `builder`, `dev`, `runtime` — selected by `target:` in `compose.dev.yaml` / `compose.prod.yaml`. Two friction points became visible quickly:

1. **The dev environment can't ride upstream improvements.** [BrowserHive](https://github.com/uraitakahito/browserhive) — and a growing set of sibling Node projects — already share a developer image template at [`uraitakahito/hello-javascript`](https://github.com/uraitakahito/hello-javascript) (Debian + nvm + zsh + gh + dotfiles + Claude Code). Each downstream repo downloads `Dockerfile.dev` + `docker-entrypoint.sh` from a pinned tag in `setup.sh`. waggle's bespoke `dev` target couldn't participate; every dev-shell improvement had to be re-implemented locally.
2. **Dev and prod build contexts diverge.** A dev image bind-mounts the source tree and needs almost nothing in its build context (just an entrypoint); a prod image needs a curated whitelist (package manifest, tsconfig, openapi spec, src). A single `.dockerignore` cannot serve both well.

BrowserHive solves both with a four-file pattern: `Dockerfile.prod` (committed), `Dockerfile.dev` (downloaded by `setup.sh`, gitignored), and per-Dockerfile dockerignore files (BuildKit reads `<dockerfile>.dockerignore` in preference to `.dockerignore`). waggle adopts the same shape.

## Decision

- **`Dockerfile.prod`** is committed at the repo root. Two-stage (`builder` + `runtime`), parameterised by `ARG NODE_VERSION=22`, identical to the previous `runtime` target's behaviour.
- **`Dockerfile.dev`** and **`docker-entrypoint.sh`** are downloaded by `./setup.sh` from `https://raw.githubusercontent.com/uraitakahito/hello-javascript/refs/tags/${HELLO_JAVASCRIPT_VERSION}/` (currently pinned to `1.2.7`). Both are listed in `.gitignore`.
- **`Dockerfile.prod.dockerignore`** and **`Dockerfile.dev.dockerignore`** use the whitelist idiom (`*` then `!<path>` re-includes).
- **`compose.dev.yaml`**'s `waggle` service drops `target: dev` / `command:` / `profiles: ["run"]` / the `/app/node_modules` anonymous volume. It now runs `tty: true` + `stdin_open: true` against the downloaded `Dockerfile.dev`; the workflow is `docker compose up -d` then `docker compose exec waggle <command>`.
- **`compose.prod.yaml`**'s `waggle` service replaces `target: runtime` with `dockerfile: Dockerfile.prod` and forwards `NODE_VERSION` as a build arg; `profiles: ["run"]` is retained because waggle is a one-shot CLI in production.
- The previous root `Dockerfile` is **deleted** — `Dockerfile.prod` and the downloaded `Dockerfile.dev` cover both contexts.

## Consequences

- **Upstream dev-shell improvements land for free.** When `hello-javascript` adds a tool or fixes the entrypoint, waggle picks it up by bumping `HELLO_JAVASCRIPT_VERSION` in `setup.sh` — one line.
- **Prod context is small and reviewable.** `Dockerfile.prod.dockerignore` whitelists exactly what `Dockerfile.prod` COPYs (`package.json`, `package-lock.json`, `tsconfig.json`, `tsconfig.build.json`, `openapi/`, `src/`); `npm ci` and `tsc` cannot accidentally pick up host noise.
- **`./setup.sh` is now mandatory before any `compose.dev.yaml` invocation.** Fresh checkouts that run `docker compose -f compose.dev.yaml up` without `./setup.sh` will fail with `Dockerfile.dev: not found`. Documented in README's Quickstart and `docs/development.md` Troubleshooting.
- **Dev shell ergonomics shift.** Previously `docker compose run --rm waggle <args>` ran a one-shot `tsx` invocation. Now `docker compose up -d` brings up an idle `tail -F /dev/null` container and you `docker compose exec waggle …` (or `… exec waggle zsh` for an interactive shell). This matches BrowserHive's developer flow.
- **Dev image is heavier.** hello-javascript pulls in zsh, gh, eza, dotfiles, Claude Code, etc. — ~1GB+ on first build. Acceptable cost for shared upstream improvements; if it becomes painful, a thin custom alternative is the documented fallback (see _Alternatives_ below).
- **`node_modules` lifecycle changes in dev.** The dev image no longer bundles waggle's deps; `docker compose exec waggle bash -lc 'npm ci'` is the one-time bootstrap after first `up`.

## Alternatives considered

- **Hand-write a thin `Dockerfile.dev` based on `node:22-bookworm-slim`.** Rejected: it duplicates effort that hello-javascript already centralises and forces every dev-shell improvement (zsh, gh, dotfiles, Claude Code) to be re-implemented per-project. Kept as the documented fallback if the heavyweight image cost becomes unacceptable.
- **Keep the single multi-stage `Dockerfile` and just split the `.dockerignore`.** Rejected: solves only friction point (2). Friction point (1) — the inability to ride upstream dev-shell improvements — remains.
- **Vendor `hello-javascript` as a git submodule.** Rejected: BrowserHive uses the curl-from-pinned-tag approach for exactly the simplicity it provides (no submodule init, no detached-HEAD navigation), and waggle should match. Submodules also force a working-tree relationship with the template repo that we don't need.

## References

- [`setup.sh`](../../setup.sh) — `HELLO_JAVASCRIPT_VERSION` lives here; bump to upgrade the dev image.
- [`Dockerfile.prod`](../../Dockerfile.prod), [`Dockerfile.prod.dockerignore`](../../Dockerfile.prod.dockerignore), [`Dockerfile.dev.dockerignore`](../../Dockerfile.dev.dockerignore)
- [`compose.dev.yaml`](../../compose.dev.yaml), [`compose.prod.yaml`](../../compose.prod.yaml)
- BrowserHive's setup.sh (the pattern this ADR mirrors): https://github.com/uraitakahito/browserhive/blob/main/setup.sh
- hello-javascript template (the dev image source): https://github.com/uraitakahito/hello-javascript
- [ADR 0002](0002-vendor-openapi-spec.md) — vendoring upstream artefacts (OpenAPI spec); this ADR is the same flavour of "track upstream from a pinned local copy" decision applied to the dev image.
