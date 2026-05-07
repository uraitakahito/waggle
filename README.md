# waggle

Higher-level capture client and orchestrator built on top of [BrowserHive](https://github.com/uraitakahito/browserhive) (pinned to tag `1.3.0`). Reads URLs from a Postgres `urls` table, submits them to a BrowserHive instance, and (in later stages) tracks lifecycle and persists artefacts.

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
docker compose -f compose.prod.yaml --profile run up --build --exit-code-from waggle
```

`--exit-code-from waggle` keeps the rest of the stack up while the one-shot init services (`seaweedfs-init`, `waggle-migrator`, `waggle-seeder`) complete, then tears everything down once `waggle` itself exits and forwards `waggle`'s exit code as the compose exit code. (Plain `--abort-on-container-exit` is incompatible with one-shot dependencies — it aborts on the first one's successful exit before downstream services have a chance to run.)

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
