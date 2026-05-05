# waggle

Higher-level capture client and orchestrator built on top of [BrowserHive](https://github.com/uraitakahito/browserhive). Reads URLs from a YAML data file, submits them to a BrowserHive instance, and (in later stages) tracks lifecycle and persists artefacts.

> The name comes from the [waggle dance](https://en.wikipedia.org/wiki/Waggle_dance) bees use to direct hive-mates to nectar — fitting for a client that tells the BrowserHive what to capture.

## Quickstart (Docker Compose)

Bring up BrowserHive plus the two Chromium servers it depends on, then fire one capture run from the bundled sample data:

```sh
./setup.sh                 # generate .env from host info (always regenerated)
docker compose -f compose.dev.yaml up --build -d \
  chromium-server-1 chromium-server-2 browserhive
docker compose -f compose.dev.yaml run --rm waggle \
  --data data/sample.yaml --jpeg --html --limit 3
```

You should see one `Request accepted` line per submitted URL and a `Request summary` at the end. Open `http://localhost:6080/` and `http://localhost:6081/` (noVNC) to watch each Chromium tab render.

To smoke-test the whole stack in one shot:

```sh
docker compose -f compose.dev.yaml --profile run up --build
```

## Quickstart (host Node, BrowserHive remote)

If you already have a BrowserHive instance running somewhere, you can run waggle directly:

```sh
nvm use                                   # Node 22 (see .nvmrc)
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
npm run check          # typecheck + lint + format:check + tests
npm run dev -- --data data/sample.yaml --jpeg --limit 1 --server http://...
```

See [`docs/development.md`](docs/development.md) for the full guide and [`docs/architecture.md`](docs/architecture.md) for how the pieces fit together. Architectural decisions are recorded under [`docs/adr/`](docs/adr/).

## Project layout

```
src/cli.ts            CLI entry (shebang)
src/index.ts          library exports
src/client/           submit / orchestration / OpenAPI client wrapper
src/config/           commander option parser
src/data/             YAML data-file loader
src/http/generated/   @hey-api/openapi-ts output (committed; CI guards drift)
src/types/            shared types (Result, CaptureFormats)
openapi/              vendored copy of upstream src/http/openapi.yaml
data/                 sample data files for smoke runs
test/                 vitest unit tests
docs/                 vision / roadmap / architecture / development / ADRs
compose.dev.yaml      4-service dev stack (chromium ×2, browserhive, waggle)
compose.prod.yaml     production-flavour stack (headless chromium, runtime image)
Dockerfile            multi-stage: builder, dev, runtime
```

## License

Released into the public domain — see [`LICENSE`](LICENSE).

waggle is built on top of upstream [BrowserHive](https://github.com/uraitakahito/browserhive) and [chromium-server-docker](https://github.com/uraitakahito/chromium-server-docker), both also Unlicense.
