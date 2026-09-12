# capture-ledger

A capture orchestrator built on [BrowserHive](https://github.com/uraitakahito/browserhive).
It answers one question — **which URLs get captured** — by reading the enabled rows
of a Postgres `urls` table and submitting one capture per row. What comes back goes
into an archive ledger, and callers allowed to read an archive get a short-lived
signed URL for it.

## Documentation

Everything — quickstart, and guides (development environment, URL source, capture
options, archive ledger, architecture) — lives on the docs site:

- **English** — <https://uraitakahito.github.io/capture-ledger/>
- **日本語** — <https://uraitakahito.github.io/capture-ledger/ja/>

Anything about _how_ a page is captured — behaviors, WACZ, storage, the browser —
belongs to BrowserHive. Its docs are not published on the web; build them from the
BrowserHive checkout with `pnpm run docs:local`.

## Related Projects

- [BrowserHive](https://github.com/uraitakahito/browserhive) — the capture server capture-ledger drives.
- [OpenFGA](https://openfga.dev/) — the authorization store behind the archive ledger.

## License

[Unlicense](./LICENSE).
