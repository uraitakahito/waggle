# Vision

waggle is the **caller** side of [BrowserHive](https://github.com/uraitakahito/browserhive). BrowserHive is a fire-and-forget capture server with an HTTP API; waggle wraps that API into a useful client/orchestrator for batch capture work.

The starting point — Stage 0 — is feature parity with upstream's `examples/data-client.ts`: read a YAML data file, submit each URL, log a 202-or-rejected line, summarise. Everything beyond that is where waggle earns its keep.

## What we are building

In priority order:

1. **Lifecycle management & artefact persistence.** Track submitted task IDs through to terminal status. Pull the captured PNG / JPEG / HTML / PDF / links artefacts and write them to local FS or S3-compatible storage.
2. **Reliability.** Idempotent retries keyed on `correlationId`, exponential backoff for transient failures, persistent run state so an interrupted batch can resume.
3. **Observability.** Prometheus metrics, structured logs, OpenTelemetry traces.
4. **Service mode.** Long-running daemon that consumes from a queue (Redis / RabbitMQ / etc.), accepts webhook completions, and load-balances across multiple BrowserHive instances.
5. **Pipeline composability.** Pre-/post-hooks, plugin extension points, multi-step capture flows.

Each layer is purposely additive — Stage N+1 is a strict superset of Stage N. The function-level boundaries created in Stage 0 (`submit(entry, options) -> SubmitResult`, `load(source) -> DataEntry[]`) anticipate this.

## What we are _not_ building

- **A second capture engine.** BrowserHive owns the Chromium worker pool, queue, and OpenAPI contract. waggle never reaches into a Chromium directly.
- **A web UI.** waggle is CLI-first and library-friendly. A UI may live in a future sibling project.
- **A general-purpose web crawler.** Pipeline hooks (Stage 6) will let users compose discovery + capture flows, but waggle itself stays out of crawl heuristics.
- **Schema-defining.** The OpenAPI spec is owned by BrowserHive. waggle vendors a copy and rebuilds drift checks; it does not extend the API.

## Relationship to upstream

- **Vendoring, not forking.** waggle copies `src/http/openapi.yaml` into `openapi/browserhive.yaml` and regenerates types via `@hey-api/openapi-ts`. CI guards drift; `npm run openapi:sync` re-pulls. See [ADR 0002](adr/0002-vendor-openapi-spec.md).
- **No source-code dependency.** Run-time and build-time, waggle talks only to BrowserHive's HTTP API. The Docker Compose stacks build BrowserHive and chromium-server-docker from upstream Git contexts (`*_REF` env vars to pin).
- **Upstreaming policy.** Bug fixes that apply to BrowserHive's `examples/data-client.ts` itself should be sent upstream, not just patched in waggle. waggle is the place for _new_ capability that doesn't fit the "minimal example" remit upstream.
