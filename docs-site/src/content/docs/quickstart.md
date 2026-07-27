---
title: Quickstart
description: Bring the Compose stack up, seed the urls table, and submit your first capture.
---

The Compose stack brings up everything waggle needs — Postgres, SeaweedFS,
two headless Chromium workers, and a BrowserHive built from the
[pinned tag](/waggle/upgrading-browserhive/).

## 1. Generate the local files

```sh
./setup.sh
```

`setup.sh` writes `.env` and downloads three things that are deliberately not
committed: `Dockerfile.dev` and `docker-entrypoint.sh` from the
`hello-javascript` template, and `etc/seaweedfs/*` from the pinned BrowserHive
tag. Running it is mandatory before any `docker compose` invocation.

## 2. Start the stack

```sh
docker compose -f compose.dev.yaml up --build -d
```

The first build compiles BrowserHive and the Chromium image from source, so
expect several minutes. Check the state — until the stack is up, curl reports
the failure itself:

```sh
curl -sS --fail-with-body http://localhost:8080/v1/status | jq '{isRunning, workers: [.workers[].health]}'
# → { "isRunning": true, "workers": ["ready", "ready"] }
```

The workers are headless. To watch one render, open `chrome://inspect` in a
local Chrome and add `localhost:9222` and `localhost:9223` under _Configure…_.

## 3. Prepare the database

The waggle container is a long-running shell, idle until you use it. Its
`node_modules` is not baked into the image, so install once:

```sh
docker compose -f compose.dev.yaml exec waggle zsh
# inside the container:
npm ci                        # first time only
npm run db:migrate            # create the urls table
npm run db:seed               # load the five sample URLs
```

:::caution
The repository is bind-mounted at `/app`, so `npm ci` **inside the container
overwrites the host's `node_modules` with Linux binaries**. Run `npm ci` on the
host again before working outside the container.
:::

## 4. Submit a capture

```sh
npm run dev -- --wacz --limit 1
```

Each accepted URL produces one log line, and the run ends with a summary:

```json
{"msg":"Request accepted","progress":"1/1","taskId":"e785962b-…","labels":["Apple"]}
{"msg":"Request summary","total":1,"accepted":1,"rejected":0,"durationMs":23}
```

`accepted` means BrowserHive queued the work — not that the capture finished.

## 5. See what came out

waggle exposes no endpoint for that; the capture is asynchronous and the result
belongs to BrowserHive. Read its completion log:

```sh
docker compose -f compose.dev.yaml logs browserhive \
  | grep '"Task completed"' | tail -1 | jq -c '{waczLocation, completeness}'
```

Artifacts land in the bundled SeaweedFS bucket (`browserhive`). How they are
named and what a WACZ contains is documented on
[BrowserHive's storage page](https://uraitakahito.github.io/browserhive/storage/).

## Next

- Add your own URLs → [URL source](/waggle/url-source/)
- Change how pages are captured → [Capture options](/waggle/capture-options/)
- Work without Compose → [Development environment](/waggle/development-environment/)
