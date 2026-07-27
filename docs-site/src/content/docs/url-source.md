---
title: URL source
description: The urls table waggle reads, and how to manage it.
---

waggle's entire input is one Postgres table. **waggle never inserts into it** —
populating `urls` is the caller's job, whether that is a manual `INSERT`, an
external pipeline, or the bundled seed.

## The query

Every run is this, and nothing more:

```sql
SELECT url, labels FROM urls WHERE enabled ORDER BY id ASC [LIMIT $1]
```

`ORDER BY id ASC` means rows are submitted in insertion order, and `--limit`
takes the first _n_ — so a smoke test always exercises the same URLs.

## Schema

```ts file="src/db/migrations/001-create-urls.ts#urls-columns"

```

| Column                      | Notes                                                                                                                    |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `id`                        | `BIGSERIAL` primary key. Insertion order, preserved by the loader's `ORDER BY`.                                          |
| `url`                       | `CHECK (url <> '' AND url = btrim(url))` — the database rejects empty and untrimmed values, so the CLI does not have to. |
| `url_hash`                  | Generated `digest(url, 'sha256')` (pgcrypto), stored. Backs the unique index; nothing reads it directly.                 |
| `labels`                    | `TEXT[]`. Sent as-is to BrowserHive, which composes them into artifact filenames.                                        |
| `enabled`                   | The hot path is `WHERE enabled`, covered by the partial index `urls_enabled_id_idx`. Disabled rows cost nothing.         |
| `created_at` / `updated_at` | `now()` defaults. No auto-update trigger today.                                                                          |

`urls_url_hash_key` is unique, so the same URL cannot be enqueued twice.

## Labels

Labels are free-form and end up in the artifact filename, which makes them the
natural place for an external key. The bundled fixture uses a securities code
alongside a company name:

```ts
{ url: "https://www.ana.co.jp/group/", labels: ["9202", "ANAHoldings"] }
```

## Adding URLs

```sql
INSERT INTO urls (url, labels) VALUES
  ('https://example.com/', ARRAY['example']),
  ('https://example.org/', ARRAY['example', 'org'])
ON CONFLICT (url_hash) DO NOTHING;
```

To take a URL out of rotation without losing its history, set `enabled = false`
rather than deleting the row.

## Migrations

Migration files live under `src/db/migrations/<NNN>-<description>.ts` and export
`up(db)` / `down(db)`. The runner is a thin wrapper around Kysely's `Migrator`
with `FileMigrationProvider`; applied IDs are tracked in the `kysely_migration`
ledger (`kysely_migration_lock` guards concurrent runs), so re-running
`npm run db:migrate` is a no-op once current.

```sh
npm run db:migrate        # apply
npm run db:migrate:down   # revert the last one
```

To add one:

1. Pick the next ordinal, e.g. `002-add-priority.ts`.
2. Implement `up` and `down` with the schema builder, or ``sql`…`.execute(db)``
   for what it does not cover — extensions, generated columns, `CHECK`
   expressions referencing other columns.
3. Round-trip locally: `npm run db:migrate && npm run db:migrate:down && npm run db:migrate`.
   CI runs the same round trip.
4. Commit the migration and the code that depends on it together.

Seeds have the same shape under `src/db/seeds/` but use a separate `kysely_seed`
ledger, so they can be applied and reverted independently.
