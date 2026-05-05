# Roadmap

waggle is delivered in additive stages. Every stage produces something runnable; later stages only add capability, never remove it.

| Stage | Name                   | Headline                                                                        |
| ----- | ---------------------- | ------------------------------------------------------------------------------- |
| **0** | **初版**               | Project scaffolding ＋ feature parity with upstream `examples/data-client.ts`   |
| 1     | Lifecycle tracking     | Poll `taskId` to terminal status; surface completed/failed in `SubmitResult`    |
| 2     | Artefact persistence   | Download PNG / JPEG / HTML / PDF / links and write to local FS or S3-compatible |
| 3     | Reliability            | Exponential backoff, `correlationId`-keyed idempotent re-submit, resumable runs |
| 4     | Observability          | Prometheus metrics, structured logs, OpenTelemetry traces                       |
| 5     | Service mode           | Long-running daemon, queue consumer, webhook receiver, multi-BrowserHive LB     |
| 6     | Pipeline composability | Pre-/post-hooks, plugin extension points, multi-step capture flows              |

## Stage 0 — initial version (this checkpoint)

- TypeScript / Node 22 ESM scaffolding, `npm` toolchain
- ESLint flat config, prettier, vitest
- @hey-api/openapi-ts client generated from `openapi/browserhive.yaml` (drift-checked in CI)
- `src/data/yaml-loader.ts`, `src/config/cli-options.ts`, `src/client/submit.ts`, `src/client/run.ts`
- `src/cli.ts` (`#!/usr/bin/env node`) and `src/index.ts` library export
- 27 vitest unit tests
- Multi-stage `Dockerfile` (builder / dev / runtime)
- `compose.dev.yaml` + `compose.prod.yaml` covering chromium-server-1, chromium-server-2, BrowserHive, and waggle on `chromium-network`
- GitHub Actions CI: typecheck + lint + format + test + build + OpenAPI drift

## Stage 1 — lifecycle tracking

- New `pollTask(taskId)` helper using BrowserHive's `getStatus` operation
- `SubmitResult` becomes `TaskResult` with terminal status (`completed` / `failed`)
- `runClient` gains a `--wait` mode that follows submissions to completion
- Concurrency cap on outstanding polls, configurable poll interval

## Stage 2 — artefact persistence

- `Storage` adapter interface (`local-fs`, `s3-compatible`)
- Output filename mirrors BrowserHive's pattern: `{taskId}_{correlationId}_{labels}.{ext}`
- BrowserHive output dir is read via a sidecar that ships artefacts to the configured Storage
- New Compose service: MinIO (dev), real S3 / GCS (prod via env)

## Stage 3 — reliability

- Retry policy with exponential backoff for transport-level failures
- Idempotent re-submission keyed on `correlationId`
- Run state on disk (SQLite or JSONL ledger) so an interrupted run can resume

## Stage 4 — observability

- Prometheus metrics endpoint
- Structured logs aligned with BrowserHive's pino schema (per-task taskId/correlationId)
- Optional OpenTelemetry tracing (waggle ↔ BrowserHive span propagation)

## Stage 5 — service mode

- Long-running daemon (`waggle serve`)
- Queue consumer driver (Redis, RabbitMQ; pluggable)
- Webhook receiver for BrowserHive completion callbacks
- Multi-BrowserHive load balancing with health-aware routing

## Stage 6 — pipeline composability

- Pre-hook (URL transform / dedupe), post-hook (artefact transform / dispatch)
- Plugin discovery via `package.json#waggle.plugins`
- Multi-step capture flows (e.g. discover-then-capture)
