# waggle

Higher-level capture client and orchestrator built on top of [BrowserHive](https://github.com/uraitakahito/browserhive). Reads URLs from a YAML data file, submits them to a BrowserHive instance, and (in later stages) tracks lifecycle and persists artefacts.

> The name comes from the [waggle dance](https://en.wikipedia.org/wiki/Waggle_dance) bees use to direct hive-mates to nectar — fitting for a client that tells the BrowserHive what to capture.

## Quickstart (Docker Compose)

```sh
./setup.sh
docker compose -f compose.dev.yaml up --build -d
docker compose -f compose.dev.yaml exec waggle zsh
# inside the container:
npm ci                                                                # first time only
npx tsx src/cli.ts --data data/sample.yaml --jpeg --html --limit 3
```

You should see one `Request accepted` line per submitted URL and a `Request summary` at the end. Open `http://localhost:6080/` and `http://localhost:6081/` (noVNC) to watch each Chromium tab render.

To smoke-test the production image end-to-end (builds `Dockerfile.prod`, runs one capture, exits):

```sh
docker compose -f compose.prod.yaml --profile run up --build --abort-on-container-exit
```

`--abort-on-container-exit` stops the BrowserHive + chromium services as soon as `waggle-prod` exits, so the whole stack tears down on its own.

## Quickstart (host Node, BrowserHive remote)

If you already have a BrowserHive instance running somewhere, you can run waggle directly:

```sh
nvm use                                   # Node 24 (see .nvmrc)
npm ci
npm run build
node dist/cli.js \
  --data data/sample.yaml --jpeg --limit 3 \
  --server http://localhost:8080
```

`--server` falls back to the `BROWSERHIVE_SERVER` env var when omitted.

## Develop

```sh
npm ci
npm run check
npm run dev -- --data data/sample.yaml --jpeg --limit 1 --server http://...
```

See [`docs/development.md`](docs/development.md) for the full guide and [`docs/architecture.md`](docs/architecture.md) for how the pieces fit together. Architectural decisions are recorded under [`docs/adr/`](docs/adr/).
