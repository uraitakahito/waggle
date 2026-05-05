# ADR 0002: Vendor BrowserHive's OpenAPI spec; commit generated client

- Status: Accepted
- Date: 2026-05-05
- Deciders: takaurai

## Context

waggle calls BrowserHive's HTTP API. BrowserHive's `src/http/openapi.yaml` is the single source of truth for the contract. We need three things:

1. waggle's TypeScript types must stay in sync with the spec.
2. waggle must not break silently when upstream evolves the spec — drift must be visible.
3. waggle's source layout must not depend on having BrowserHive checked out alongside it.

Three positions to choose from:

- (a) Depend on `browserhive` as an npm package and import the generated client from it.
- (b) Vendor `openapi.yaml` into waggle and regenerate locally with `@hey-api/openapi-ts`.
- (c) Hand-write types and fetch calls.

## Decision

We **vendor** `openapi/browserhive.yaml` (a verbatim copy of upstream's `src/http/openapi.yaml`) and **commit** the regenerated `src/http/generated/` tree. CI runs `npm run openapi:check` to fail any PR where the generated tree is out of sync with the vendored spec. `npm run openapi:sync` re-pulls the latest spec from upstream `main`.

## Consequences

- **No source-layout coupling to upstream.** waggle builds and runs without BrowserHive on disk.
- **Drift is visible.** A stale spec causes a CI failure with a diff on the generated tree, not a runtime mismatch in production.
- **Generated code is reviewable.** Because it is committed, every spec refresh shows up as a normal PR with reviewable diffs.
- **Tradeoff: Re-pulling is manual.** A scheduled `openapi:sync` run is a future automation candidate; for now humans run it.

## Alternatives considered

- **(a) Depend on `browserhive` as an npm dependency.** Rejected: upstream does not publish the generated client as a package, and adding a "publish a package" workflow upstream is out of scope. Even if upstream did publish, waggle would still need spec-drift visibility.
- **(c) Hand-written types.** Rejected: defeats the purpose of having an OpenAPI spec, and forces every spec change to be re-implemented by hand.
- **Vendor the spec but gitignore the generated tree** (the upstream approach). Rejected: it removes review-time visibility of changes and requires re-generation on every install. Committing makes the diff visible and decouples install speed from generation.

## References

- `openapi-ts.config.ts`
- [`docs/development.md`](../development.md) (refresh workflow)
- [@hey-api/openapi-ts](https://heyapi.dev/openapi-ts) (the generator we use)
