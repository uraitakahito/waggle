# Architecture

## Stage 0 (current)

```
   YAML data file
        │
        ▼
   ┌──────────────────────────────────────────────┐
   │ waggle (Node 24 / TypeScript / commander)    │
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

## Network layout

All Compose services share the `chromium-network` bridge:

| Service           | Container hostname  | Container port | Host port (`compose.dev.yaml`)                                                                           |
| ----------------- | ------------------- | -------------- | -------------------------------------------------------------------------------------------------------- |
| chromium-server-1 | `chromium-server-1` | 9222 (CDP)     | 9222                                                                                                     |
| chromium-server-1 | `chromium-server-1` | 6080 (noVNC)   | 6080                                                                                                     |
| chromium-server-2 | `chromium-server-2` | 9222 (CDP)     | 9223                                                                                                     |
| chromium-server-2 | `chromium-server-2` | 6080 (noVNC)   | 6081                                                                                                     |
| browserhive       | `browserhive`       | 8080 (HTTP)    | `${BROWSERHIVE_HOST_PORT:-8080}`                                                                         |
| waggle            | `waggle`            | (no listener)  | dev: long-running shell on `compose.dev.yaml`; prod: one-shot via `--profile run` on `compose.prod.yaml` |

`compose.prod.yaml` strips the noVNC port mappings (chromium servers are internal-only) and uses headless chromium-server-docker images.
