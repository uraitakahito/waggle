---
title: Quickstart
description: Bring the Compose stack up, seed the urls table, and submit your first capture.
---

The stack brings up everything waggle needs — Postgres, SeaweedFS, two headless
Chromium workers, and a BrowserHive built from the
[pinned submodule](/waggle/upgrading-browserhive/). It runs on
[Apple Container](https://github.com/apple/container), driven by
`container-compose`.

## 1. Register the DNS domain (once per machine)

```sh
sudo container system dns create waggle
```

The project name is the DNS domain: containers become `<service>.waggle`,
resolvable from each other **and from the host** — which is what lets waggle
itself run on the host against this stack. Without it, container-compose falls
back to patching `/etc/hosts`, which fails silently for the non-root containers
here.

## 2. Generate the local files

```sh
./setup.sh
```

It checks the toolchain, initialises the `.upstream/browserhive` submodule (all
upstream source arrives that way), and writes `.env`. Mandatory before any
`container-compose` invocation.

## 3. Start the stack

```sh
container-compose up -d -b
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

## 4. Prepare the database

**There is no dev container.** waggle runs on the host and reaches the stack by
name — `.env` already holds the connection strings:

```sh
npm ci                        # first time only
npm run db:migrate            # create the urls table
npm run db:seed               # load the five sample URLs
```

## 5. Submit a capture

```sh
npm run dev -- --wacz --limit 1
```

Each accepted URL produces one log line, and the run ends with a summary:

```json
{"msg":"Request accepted","progress":"1/1","taskId":"e785962b-…","labels":["Apple"]}
{"msg":"Request summary","total":1,"accepted":1,"rejected":0,"durationMs":23}
```

`accepted` means BrowserHive queued the work — not that the capture finished.

## 6. See what came out

waggle exposes no endpoint for that; the capture is asynchronous and the result
belongs to BrowserHive. Read its completion log:

```sh
container logs browserhive.waggle \
  | grep '"Task completed"' | tail -1 | jq -c '{waczLocation, completeness}'
```

Artifacts land in the bundled SeaweedFS bucket (`browserhive`). How they are
named and what a WACZ contains is documented on
[BrowserHive's storage page](https://uraitakahito.github.io/browserhive/storage/).

## Next

- Add your own URLs → [URL source](/waggle/url-source/)
- Change how pages are captured → [Capture options](/waggle/capture-options/)
- Work without Compose → [Development environment](/waggle/development-environment/)
