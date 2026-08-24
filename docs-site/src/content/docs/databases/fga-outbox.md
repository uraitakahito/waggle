---
title: fga_outbox
description: A box for tuples waiting to be sent to OpenFGA — the answer to having no transaction across two stores.
---

**A box for tuples waiting to be sent to OpenFGA.** Despite the name it is
**waggle's table**, not one of OpenFGA's.

```ts file="src/db/migrations/003-create-fga-outbox.ts#fga-outbox-columns"

```

## Why it exists

Registering an archive means writing two things.

| What            | Where                  |
| --------------- | ---------------------- |
| the archive row | Postgres (SQL)         |
| the tuples      | OpenFGA (**HTTP API**) |

**No transaction spans both.** Doing them independently means one can land
without the other, and both outcomes are bad:

- an archive nobody can reach
- a permission pointing at a row that rolled back

So the tuple write is **recorded as an intent, inside the same transaction as the
archive**. Either both land or neither does.

```ts
return db.transaction().execute(async (trx) => {
  const inserted = await trx.insertInto("archives").values({ … }).executeTakeFirst();
  if (!inserted) return { reason: "already-known" };

  await trx.insertInto("fgaOutbox").values({ payload: JSON.stringify({ writes: [ … ] }) }).execute();
});
```

## What the payload holds

```json
{
  "writes": [
    { "user": "capture_job:7f170ae4-…", "object": "archive:3a4cb75c-…", "relation": "parent" },
    { "user": "organization:acme", "object": "capture_job:7f170ae4-…", "relation": "parent" }
  ]
}
```

Two at a time: the archive to its job, and that job to its organization. Both are
needed before a member of the organization can reach the archive.

## Delivery

`waggle-ledger drain`, or the API process's timer, drains it.

```sql
SELECT … FROM fga_outbox WHERE processed_at IS NULL
ORDER BY id FOR UPDATE SKIP LOCKED LIMIT 100
```

**`FOR UPDATE SKIP LOCKED` lets any number of drains run at once** — the API's
timer and a hand-run `waggle-ledger drain`. Neither processes the same row twice
nor waits on the other.

Delivery is **at-least-once**: a row stays until OpenFGA accepts it. The other
path — deleting on send — drops a tuple every time the process dies between the
write and the update, and **a missing tuple is invisible until someone is wrongly
refused**.

:::caution[An OpenFGA write is transactional across the whole batch]
If a single tuple in the batch already exists, **the entire request is rejected
and nothing is written** — including the tuples that were new.

This is not hypothetical: **a re-registered archive produces exactly that shape**
every time, since a fresh `archive → capture_job` sits next to an
`organization → capture_job` from an earlier row.

So a failed batch cannot simply be read as delivered. The worker tries the batch
first and, **only when it failed because something already existed**, retries one
tuple at a time.
:::

## Why processed rows are not deleted

```
processed_at IS NULL     → not yet delivered
processed_at IS NOT NULL → delivered; the row stays
```

**The worker never deletes rows.** A processed row is evidence that a tuple was
written, and it is worth having when reconciling the ledger against OpenFGA.

## Indexes

```sql
fga_outbox_pkey         PRIMARY KEY (id)
fga_outbox_pending_idx  (id) WHERE processed_at IS NULL   -- only the undelivered
```

`fga_outbox_pending_idx` is **partial** because draining always carries
`WHERE processed_at IS NULL`. However many delivered rows pile up, finding the
undelivered ones costs the same.
