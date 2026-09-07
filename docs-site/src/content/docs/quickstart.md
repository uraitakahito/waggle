---
title: Quickstart
description: Bring the Compose stack up, seed the capture_targets table, and submit your first capture.
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
container-compose up -d -b
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

:::note[Skip this if you only want to submit a capture]
This step is only needed for the API and picker in §7. `pnpm run capture` does
not go through OpenFGA.
:::

## 6. Submit a capture

```sh
pnpm run capture --wacz --limit 1
```

Each accepted URL produces one log line, and the run ends with a summary:

```json
{"msg":"Request accepted","progress":"1/1","taskId":"e785962b-…","labels":["Apple"]}
{"msg":"Request summary","total":1,"accepted":1,"rejected":0,"durationMs":23}
```

`accepted` means BrowserHive queued the work — not that the capture finished.

## 7. See what came out

The listing and the picker are served by `waggle-api`, which **runs on the
host** — the stack has no such service, for the same reason as §5: the OpenFGA
ids do not exist until after startup.

```sh
pnpm run api
open http://127.0.0.1:7070/
```

Clicking a row opens it in [replay](https://github.com/uraitakahito/replay). The
listing comes from the ledger (the `archives` table) and is **filtered by
OpenFGA's `can_view`**. You can also call the API directly:

```sh
curl -s -H "X-Waggle-Subject: $(whoami)" -H "X-Waggle-Organizations: acme" \
  http://127.0.0.1:7070/api/archives | jq '.archives[0]'
```

An empty listing usually means `WAGGLE_DEV_IDENTITY=1` is missing from `.env` —
without it the resolver admits nobody and the picker stays empty with `401`.
See [Archive ledger](/waggle/archive-ledger/) for the whole surface.

### While it is still running

**A capture reaches the ledger only after it finishes.** If it is not in the
picker it is either still being taken or it failed. **Progress lives only in
BrowserHive** — that is the system of record; what waggle holds is a copy of
finished facts.

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

- Serve and share archives → [Archive ledger](/waggle/archive-ledger/)
- Add your own URLs → [URL source](/waggle/url-source/)
- Change how pages are captured → [Capture options](/waggle/capture-options/)
- Work without Compose → [Development environment](/waggle/development-environment/)
