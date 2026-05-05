# Architecture

## Stage 0 (current)

```
   YAML data file
        │
        ▼
   ┌──────────────────────────────────────────────┐
   │ waggle (Node 22 / TypeScript / commander)    │
   │  ┌────────────────┐  ┌───────────────────┐   │
   │  │ yaml-loader    │─▶│ cli-options       │   │
   │  └────────────────┘  └─────────┬─────────┘   │
   │                                ▼             │
   │  ┌────────────────────────────────────────┐  │
   │  │ run.ts  ──▶  submit.ts (parallel)      │  │
   │  └─────────────────┬──────────────────────┘  │
   │                    ▼                         │
   │      @hey-api/openapi-ts SDK (fetch)         │
   └────────────────────┬─────────────────────────┘
                        │ HTTP POST /v1/captures
                        ▼
        ┌──────────────────────────────────────┐
        │ BrowserHive (port 8080)              │
        │   coordinator + worker pool          │
        └────────┬───────────────────┬─────────┘
                 │ CDP 9222          │ CDP 9222
                 ▼                   ▼
        ┌──────────────────┐ ┌──────────────────┐
        │ chromium-server-1│ │ chromium-server-2│
        │   noVNC :6080    │ │   noVNC :6081    │
        └──────────────────┘ └──────────────────┘
```

waggle's interaction model is **fire-and-forget**: every entry in the YAML data file is POSTed to `/v1/captures`. BrowserHive returns 202 + `taskId` and processes the capture asynchronously on its worker pool. Stage 0 records 202s and rejections, then exits.

## Future stages (preview)

```
   ┌──────────────────────────────────────────────────────┐
   │ waggle                                               │
   │                                                      │
   │  yaml/jsonl/csv loader ─▶ pipeline pre-hook ─┐       │
   │                                              ▼       │
   │  submit ──▶ poll (Stage 1) ──▶ download (Stage 2)   │
   │                                              │       │
   │  retry/resume (Stage 3) ◀────────────────────┤       │
   │                                              ▼       │
   │              metrics / OTEL (Stage 4) ◀─ post-hook   │
   │                                                      │
   │  serve (Stage 5): queue consumer, webhook, LB        │
   └──────────────────────────────────────────────────────┘
                       │             │
                       ▼             ▼
              BrowserHive #1   BrowserHive #N
                       │
                       ▼
              Storage (local FS / S3 / Postgres ledger)
```

The Stage 0 boundaries are deliberately function-shaped (`submit(entry, options) -> SubmitResult`, `load(source) -> DataEntry[]`) so later stages can wrap or compose without rewriting the call sites.

## Network layout

All Compose services share the `chromium-network` bridge:

| Service           | Container hostname  | Container port | Host port (`compose.dev.yaml`)                |
| ----------------- | ------------------- | -------------- | --------------------------------------------- |
| chromium-server-1 | `chromium-server-1` | 9222 (CDP)     | 9222                                          |
| chromium-server-1 | `chromium-server-1` | 6080 (noVNC)   | 6080                                          |
| chromium-server-2 | `chromium-server-2` | 9222 (CDP)     | 9223                                          |
| chromium-server-2 | `chromium-server-2` | 6080 (noVNC)   | 6081                                          |
| browserhive       | `browserhive`       | 8080 (HTTP)    | `${BROWSERHIVE_HOST_PORT:-8080}`              |
| waggle            | `waggle`            | (no listener)  | (one-shot client; opt in via `--profile run`) |

`compose.prod.yaml` strips the noVNC port mappings (chromium servers are internal-only) and uses headless chromium-server-docker images.

## Code-level layout

```
src/
├── cli.ts                  # entry point (shebang)
├── index.ts                # library exports
├── logger.ts               # pino root logger
├── config/cli-options.ts   # commander program; CaptureFormats normaliser
├── data/yaml-loader.ts     # parse YAML into DataEntry[]
├── client/
│   ├── openapi-client.ts   # `client.setConfig({ baseUrl })`
│   ├── submit.ts           # one POST /v1/captures, returns SubmitResult
│   └── run.ts              # parallel orchestration + summary
├── http/generated/         # @hey-api/openapi-ts output (committed; drift-checked)
└── types/
    ├── capture.ts          # CaptureFormats
    └── result.ts           # Result<T, E> success/failure union
```
