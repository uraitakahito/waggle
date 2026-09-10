---
title: Quickstart
description: Bring the Compose stack up, seed the capture_targets table, and start your first crawl.
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
back to appending to the `/etc/hosts` **inside each container** via
`container exec` (your Mac's own `/etc/hosts` is never touched). That write
fails for the non-root containers here, and container-compose neither checks
the exit status nor prints anything — so only some services lose name
resolution, which is a hard symptom to trace back.

## 2. Generate the local files

```sh
./setup.sh
```

It checks the toolchain, initialises the `.upstream/browserhive` submodule (all
upstream source arrives that way), and writes `.env`. Mandatory before any
`container-compose` invocation.

## 3. Start the stack

```sh
pnpm run stack:up
```

The first build compiles BrowserHive and the Chromium image from source, so
expect several minutes. Check the state — until the stack is up, grpcurl reports
the failure itself:

```sh
grpcurl -plaintext -import-path proto -proto browserhive/v1/capture.proto \
  localhost:50051 browserhive.v1.CaptureService/GetStatus \
  | jq '{isRunning, workers: [.workers[].health]}'
# → { "isRunning": true, "workers": ["WORKER_HEALTH_READY", "WORKER_HEALTH_READY"] }
```

`-import-path proto -proto …` points grpcurl at the contract vendored in this
repo. BrowserHive does not serve reflection — a deliberate choice, not a gap:
enabling it would mean shipping a descriptor set and reading it at runtime,
making the `.proto` a runtime asset. So the `.proto` is how a caller learns the
service — the same file the client is generated from.

The workers are headless. To watch one render, open `chrome://inspect` in a
local Chrome and add `localhost:9222` and `localhost:9223` under _Configure…_.

## 4. Prepare the database

**There is no dev container.** waggle runs on the host and reaches the stack by
name — `.env` already holds the connection strings:

```sh
pnpm install         # first time only
pnpm run db:migrate  # create the capture_targets table
pnpm run db:seed     # load the five sample URLs
```

## 5. Prepare authorization

The archive API and the picker go through OpenFGA. **The store and model ids do
not exist until the model is deployed**, so they cannot live in compose. Run the
two commands and paste the result into `.env`:

```sh
pnpm run fga:migrate  # create the OpenFGA datastore
pnpm run fga:deploy   # push the model; prints the store id and model id
```

Copy the two printed lines into `WAGGLE_FGA_STORE_ID` and `WAGGLE_FGA_MODEL_ID`
in `.env`.

:::note[This step is not optional any more]
There is no longer a CLI that bypasses OpenFGA. Every way into waggle is the
API, and the API needs these two ids.
:::

## 6. Start the API

The API — and the picker it serves at `/` — **runs on the host**. The stack has
no such service, for the same reason as §5: the OpenFGA ids do not exist until
after startup.

```sh
pnpm run api
open http://127.0.0.1:7070/
```

An empty listing usually means `WAGGLE_DEV_IDENTITY=1` is missing from `.env` —
without it the resolver admits nobody and the picker stays empty with `401`.

:::caution[A scheduler cannot reach a loopback bind]
The default bind is `127.0.0.1`, and **a container cannot reach it**. To let
forage's Windmill run the daily crawl, start the API on all interfaces:

```sh
WAGGLE_API_HOST=0.0.0.0 pnpm run api
```

The container then points at bridge100 — `http://192.168.64.1:7070`. **A host
name will not resolve there.** That address is already forage's default for
`WAGGLE_API_URL`, so `pnpm run windmill:waggle-token` wires it up with nothing
to configure. Opening the API beyond loopback puts it in front of whatever
authentication you have configured — check that first.
:::

## 7. Start a crawl

Capturing is a crawl now: waggle plans it, and a Windmill flow does the
submitting.

```sh
curl -X POST http://127.0.0.1:7070/api/crawls \
  -H 'content-type: application/json' \
  -H "X-Waggle-Subject: $(whoami)" -H "X-Waggle-Organizations: acme" \
  -d '{"fromTargets":{"limit":1}}'
# → 202 { "crawlId": "9072b625-…" }
```

`fromTargets` seeds the crawl from the rows §4 loaded, and defaults to depth 0 —
take them, follow nothing. That is what the old `POST /api/runs` did.

:::caution[This needs the scheduler stack]
`/api/crawls` is **only served when `WAGGLE_CRAWL_WEBHOOK_URL` and
`WAGGLE_CRAWL_WEBHOOK_TOKEN` are both set** — waggle no longer talks to
BrowserHive itself, so without somewhere to dispatch to there is nothing to
serve, and the route answers `404`. The flow lives in
[forage](https://github.com/uraitakahito/forage). Everything above this step
works without it; capturing does not.

Also note `can_submit`: a caller without the grant gets `404` too. See
[Archive ledger](/waggle/archive-ledger/#who-may-start-one).
:::

## 8. See what came out

Reload the picker from §6. Clicking a row opens it in
[replay](https://github.com/uraitakahito/replay). The listing comes from the
ledger (the `archives` table) and is **filtered by OpenFGA's `can_view`**. You
can also call the API directly:

```sh
curl -s -H "X-Waggle-Subject: $(whoami)" -H "X-Waggle-Organizations: acme" \
  http://127.0.0.1:7070/api/archives | jq '.archives[0]'
```

See [Archive ledger](/waggle/archive-ledger/) for the whole surface, and
`GET /api/crawls/<crawlId>` for how the crawl itself ended.

### While it is still running

**A page reaches the ledger only after the flow reports the level it was in.**
If it is not in the picker, the level is either still open or the page failed.
**Progress lives only in BrowserHive** — that is the system of record; what
waggle holds is a copy of finished facts. waggle does not poll it, but you
still can:

```sh
grpcurl -plaintext -import-path proto -proto browserhive/v1/capture.proto \
  -d '{"taskId":"<taskId>"}' \
  localhost:50051 browserhive.v1.CaptureService/GetCapture \
  | jq -c '{state, status: .report.status, artifacts: .report.artifacts}'
```

`CAPTURE_STATE_PENDING` or `_PROCESSING` means it is still working.

Artifacts land in the bundled SeaweedFS bucket (`browserhive`). Naming and WACZ
contents are on BrowserHive's storage page.

## Next

- Serve and share archives, and the whole crawl API → [Archive ledger](/waggle/archive-ledger/)
- Add your own URLs → [URL source](/waggle/url-source/)
- Change what gets captured → [Capture options](/waggle/capture-options/)
- Work without Compose → [Development environment](/waggle/development-environment/)
