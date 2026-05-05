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
npm run db:seed                                                       # load db/seeds/sample.sql
npm run dev -- --jpeg --html --limit 3
```

`DATABASE_URL` is wired into the container by `compose.dev.yaml`. You should see one `Request accepted` line per submitted URL and a `Request summary` at the end. Open `http://localhost:6080/` and `http://localhost:6081/` (noVNC) to watch each Chromium tab render.

To smoke-test the production image end-to-end (builds `Dockerfile.prod`, applies migrations, seeds the sample fixture, runs one capture, exits):

```sh
docker compose -f compose.prod.yaml --profile run up --build --abort-on-container-exit
```

`--abort-on-container-exit` stops the BrowserHive + chromium services as soon as `waggle-prod` exits, so the whole stack tears down on its own.

## Quickstart (host Node, BrowserHive + Postgres remote)

If you already have a BrowserHive and a Postgres reachable, you can run waggle directly:

```sh
nvm use                                   # Node 24 (see .nvmrc)
npm ci
npm run build
DATABASE_URL=postgres://user:pass@db.host:5432/waggle \
  node dist/db/migrate.js                 # first time / when schema changes
node dist/cli.js \
  --jpeg --limit 3 \
  --server http://localhost:8080 \
  --database-url postgres://user:pass@db.host:5432/waggle
```

`--server` and `--database-url` fall back to the `BROWSERHIVE_SERVER` and `DATABASE_URL` env vars when omitted.

## Develop

```sh
npm ci
npm run check
DATABASE_URL=postgres://... npm run dev -- --jpeg --limit 1 --server http://...
```

See [`docs/development.md`](docs/development.md) for the full guide and [`docs/architecture.md`](docs/architecture.md) for how the pieces fit together.
