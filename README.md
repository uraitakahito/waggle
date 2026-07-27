# waggle

Higher-level capture client and orchestrator built on top of [BrowserHive](https://github.com/uraitakahito/browserhive). Reads URLs from a Postgres `urls` table, submits them to a BrowserHive instance, and (in later stages) tracks lifecycle and persists artefacts.

> The name comes from the [waggle dance](https://en.wikipedia.org/wiki/Waggle_dance) bees use to direct hive-mates to nectar — fitting for a client that tells the BrowserHive what to capture.

## 📚 Documentation

**<https://uraitakahito.github.io/waggle/>** — English and [日本語](https://uraitakahito.github.io/waggle/ja/).

|                                                                                           |                                                |
| ----------------------------------------------------------------------------------------- | ---------------------------------------------- |
| [Quickstart](https://uraitakahito.github.io/waggle/quickstart/)                           | Compose stack up, seed, first capture          |
| [Development environment](https://uraitakahito.github.io/waggle/development-environment/) | Prerequisites, daily commands, troubleshooting |
| [URL source](https://uraitakahito.github.io/waggle/url-source/)                           | The `urls` table and its migrations            |
| [Capture options](https://uraitakahito.github.io/waggle/capture-options/)                 | Which flag maps to which request field         |
| [Upgrading BrowserHive](https://uraitakahito.github.io/waggle/upgrading-browserhive/)     | The pinned tag and how to move it              |
| [Architecture](https://uraitakahito.github.io/waggle/architecture/)                       | How the pieces fit together                    |

Anything about _how_ a page is captured — behaviors, WACZ, storage, workers — belongs to BrowserHive and is documented at <https://uraitakahito.github.io/browserhive/>.

## Quickstart

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

You should see one `Request accepted` line per submitted URL and a `Request summary` at the end. Captured artefacts land in the bundled SeaweedFS bucket (`browserhive`) — point at an external S3 by overriding `BROWSERHIVE_S3_ENDPOINT` in your shell environment before `./setup.sh`. The workers are headless; watch one render from `chrome://inspect` against `localhost:9222` / `:9223`.

The full walkthrough, including how to read the results of an asynchronous capture, is in the [Quickstart](https://uraitakahito.github.io/waggle/quickstart/).

To smoke-test the production image end-to-end (builds `Dockerfile.prod`, applies migrations, seeds the sample fixture, runs one capture, exits):

```sh
./scripts/prod-smoke.sh
```

## Develop

```sh
npm ci
npm run check                 # typecheck + lint + format:check + tests
npm run site:dev              # documentation site on localhost
DATABASE_URL=postgres://... npm run dev -- --webp --limit 1 --server http://...
```

The documentation site lives in `docs-site/` and is part of the repository: `npm run site:check` fails when the docs have drifted from the code, and an English page without its Japanese counterpart is rejected.
