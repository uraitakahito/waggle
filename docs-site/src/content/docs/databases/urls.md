---
title: urls
description: The list of what to capture — the answer to the one question waggle asks.
---

**The list of what to capture.** The answer to the one question waggle asks —
which URLs get captured — lives here.

```ts file="src/db/migrations/001-create-urls.ts#urls-columns"

```

## Column notes

| Column                      | Note                                                                                                        |
| --------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `id`                        | `BIGSERIAL`, insertion order, which the loader's `ORDER BY` preserves                                       |
| `url`                       | `CHECK (url <> '' AND url = btrim(url))` — the database rejects empties and padding                         |
| `url_hash`                  | **Generated column**: `digest(url, 'sha256')`, stored. It backs the unique index and is never read directly |
| `labels`                    | `TEXT[]`, forwarded to BrowserHive and baked into artifact filenames                                        |
| `enabled`                   | Covered by the partial index `urls_enabled_id_idx`; disabled rows cost nothing                              |
| `org_id`                    | Which organization this URL belongs to, carried through to `capture_submissions`                            |
| `created_at` / `updated_at` | Default `now()`. There is no auto-update trigger yet                                                        |

:::note[Why the unique index is not on `url` itself]
Long URLs can exceed an index's size limit. **Indexing the fixed 32-byte SHA-256
instead** removes that worry, and because it is a generated column the
application never has to hash anything.
:::

## Indexes

```sql
urls_pkey            PRIMARY KEY (id)
urls_url_hash_key    UNIQUE (url_hash)          -- the same URL cannot go in twice
urls_enabled_id_idx  (id) WHERE enabled         -- partial
```

`urls_enabled_id_idx` is **partial** because every read carries `WHERE enabled`.
Indexing disabled rows would only waste space.

## Adding rows

```sh
container exec postgres.waggle psql -U waggle -d waggle -c \
  "INSERT INTO urls (url, labels) VALUES ('https://example.com/', ARRAY['example'])"
```

Inserting the same URL twice is rejected by `urls_url_hash_key`. See
[URL source](/waggle/url-source/) for more.
