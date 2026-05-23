# waggle

Higher-level capture client and orchestrator built on top of [BrowserHive](https://github.com/uraitakahito/browserhive). Reads URLs from a Postgres `urls` table, submits them to a BrowserHive instance, and (in later stages) tracks lifecycle and persists artefacts.

> The name comes from the [waggle dance](https://en.wikipedia.org/wiki/Waggle_dance) bees use to direct hive-mates to nectar — fitting for a client that tells the BrowserHive what to capture.

## Quickstart (Docker Compose)

```sh
./setup.sh
docker compose -f compose.dev.yaml up --build -d
docker compose -f compose.dev.yaml exec waggle zsh
# inside the container:
npm ci                                                                # first time only
npm run db:migrate                                                    # first time only
npm run db:seed                                                       # load src/db/seeds/001-sample-urls.ts
npm run dev -- --webp --html --limit 3
```

`DATABASE_URL` is wired into the container by `compose.dev.yaml`. You should see one `Request accepted` line per submitted URL and a `Request summary` at the end. Open `http://localhost:6080/` and `http://localhost:6081/` (noVNC) to watch each Chromium tab render. Captured artefacts land in the bundled SeaweedFS bucket (`browserhive`) on the `chromium-network` bridge — point at an external S3 by overriding `BROWSERHIVE_S3_ENDPOINT` in your shell environment before `./setup.sh`.

To smoke-test the production image end-to-end (builds `Dockerfile.prod`, applies migrations, seeds the sample fixture, runs one capture, exits):

```sh
./scripts/prod-smoke.sh
```

The script brings core services up detached, polls `/v1/status` until BrowserHive is healthy, then runs `waggle-migrator`, `waggle-seeder`, and `waggle` in sequence via `docker compose run --rm`, finally tearing the stack down via an `EXIT` trap. The script forwards `waggle`'s exit code as its own exit code.

The split (instead of a single `--profile run --exit-code-from waggle` invocation) is required because Docker Compose v5.1.2's `--abort-on-container-exit` (implied by `--exit-code-from`) fires on the **first** container exit, including the legitimate `waggle-migrator` exit 0. That triggers a stack-wide teardown, SIGTERM-ing Postgres before `waggle-seeder` can resolve it. See [`docs/development.md`](docs/development.md#why-not---profile-run---exit-code-from-waggle) for the full rationale.

## Quickstart (host Node, BrowserHive + Postgres remote)

If you already have a BrowserHive and a Postgres reachable, you can run waggle directly:

```sh
nvm use                                   # Node 24 (see .nvmrc)
npm ci
npm run build
DATABASE_URL=postgres://user:pass@db.host:5432/waggle \
  node dist/db/migrate.js                 # first time / when schema changes
node dist/cli.js \
  --webp --limit 3 \
  --server http://localhost:8080 \
  --database-url postgres://user:pass@db.host:5432/waggle
```

`--server` and `--database-url` fall back to the `BROWSERHIVE_SERVER` and `DATABASE_URL` env vars when omitted.

## Develop

```sh
npm ci
npm run check
DATABASE_URL=postgres://... npm run dev -- --webp --limit 1 --server http://...
```

See [`docs/development.md`](docs/development.md) for the full guide and [`docs/architecture.md`](docs/architecture.md) for how the pieces fit together.
