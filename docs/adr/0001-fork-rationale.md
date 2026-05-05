# ADR 0001: waggle is a separate project, not an upstream PR

- Status: Accepted
- Date: 2026-05-05
- Deciders: takaurai

## Context

Upstream [BrowserHive](https://github.com/uraitakahito/browserhive) ships an `examples/data-client.ts` that demonstrates fire-and-forget submission from a YAML data file. We want substantially more — lifecycle tracking, artefact persistence, retries, observability, eventually a long-running service mode — none of which fit upstream's "minimal example" remit.

The directional axis was confirmed up front: lifecycle management ＋ artefact persistence is the primary value waggle is meant to deliver. That alone implies a project with its own state, storage adapters, scheduling logic, and CLI surface — well beyond an example file.

## Decision

waggle lives as a **separate project** that consumes BrowserHive's HTTP API. We do not fork BrowserHive's source tree, and we do not push waggle features back into `examples/`.

## Consequences

- **Upstream stays minimal.** `examples/data-client.ts` keeps its didactic purpose; readers see the smallest possible client.
- **waggle owns its release cadence and stack choices.** We can add MinIO / Redis / OpenTelemetry / a daemon entry point without negotiating with upstream.
- **Bug fixes for the example itself still go upstream.** If a parity-level bug surfaces (e.g. the YAML parser, the commander wiring, the 202 handling), we send it as a PR to BrowserHive — not just patch waggle.
- **OpenAPI is shared.** BrowserHive owns the spec; waggle vendors a copy and rebuilds drift checks (see [ADR 0002](0002-vendor-openapi-spec.md)).
- **Cost: two repos to keep aware of.** Refreshing the vendor copy is a manual step (`npm run openapi:sync`) and CI catches drift. Minor cost given the directional gap.

## Alternatives considered

- **Fork BrowserHive and grow `examples/`.** Rejected: it muddies upstream's "minimal example" intent and forces every waggle change through upstream review. We would also need to maintain a fork divergence forever.
- **Single-PR upstream contribution to grow `data-client.ts` in place.** Rejected for the same reason at smaller scale: the feature scope (storage adapters, queue consumer, etc.) far exceeds what `examples/` should be. A 5,000-line "example" is a project, not an example.
- **Monorepo with BrowserHive + waggle in sibling packages.** Rejected: BrowserHive is independently maintained and useful on its own; coupling them under one repo would be backwards.

## References

- Plan: `/Users/takahito/.claude/plans/velvet-imagining-quasar.md` (initial Stage 0 plan)
- [`docs/vision.md`](../vision.md) — what waggle is and isn't
- [ADR 0002](0002-vendor-openapi-spec.md) — OpenAPI vendoring
