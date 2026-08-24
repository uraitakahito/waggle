---
title: Databases
description: The two Postgres instances behind waggle and OpenFGA, and the fourteen tables in them.
---

The waggle dev stack runs **two Postgres instances**. They hold different things
and are different databases.

| Container           | Holds                                                        | Who touches it with SQL |
| ------------------- | ------------------------------------------------------------ | ----------------------- |
| `postgres.waggle`   | `urls` / `archives` / `fga_outbox` and 5 more — **8 tables** | waggle                  |
| `openfga-db.waggle` | `tuple` / `authorization_model` and 4 more — **6 tables**    | OpenFGA only            |

No table appears in both. The credentials do not cross either, and `openfga-db`
publishes no port, so reaching it takes `container exec`.

## Why they are separate

Sharing one instance would invite the assumption that a tuple can be written
inside waggle's application transaction. **It cannot** — OpenFGA is written
through its HTTP API, never through SQL, so no transaction spans both.

Keeping them apart removes the room for that assumption. And it is precisely
what makes [`fga_outbox`](#fga_outbox) necessary.

## waggle's database

### urls

The list of what to capture — the answer to the one question waggle asks.

The columns are described in [URL source](/waggle/url-source/).

### capture_submissions

```ts file="src/db/migrations/004-create-capture-submissions.ts#capture-submissions-columns"

```

**This records who a capture was submitted for, at the moment it is submitted.**
BrowserHive has no notion of an organization, so when the ledger is later filled
from a `.result.json` in the bucket, that manifest carries nothing identifying
one. This table is the only source.

### archives

```ts file="src/db/migrations/002-create-archives.ts#archives-columns"

```

**The ledger: one row per capture that produced an archive.** A failed capture
uploaded nothing, so recording it would have the signing endpoint hand out URLs
for objects that do not exist.

`(bucket, object_key)` is UNIQUE, so the poller and the reconciler both reaching
the same capture is a no-op rather than a duplicate.

:::note[The absence of an owner column is deliberate]
There is no `owner_id` and no `org_id`. **Who may read an archive is a
relationship, and OpenFGA holds it.** Two places answering the same question
will eventually disagree.
:::

The number of submissions and the number of ledger rows do not match. That is
not a fault: **only captures that produced an archive enter the ledger.**

### fga_outbox

```ts file="src/db/migrations/003-create-fga-outbox.ts#fga-outbox-columns"

```

**A box for tuples waiting to be sent to OpenFGA.** Despite the name it is
waggle's table, and `payload` holds JSON like this:

```json
{
  "writes": [
    { "user": "capture_job:7f170ae4-…", "object": "archive:3a4cb75c-…", "relation": "parent" },
    { "user": "organization:acme", "object": "capture_job:7f170ae4-…", "relation": "parent" }
  ]
}
```

It is written in the same transaction as the archive row, so **either both land
or neither does**. Delivery is done by `waggle-ledger drain` or the API's timer,
retrying until OpenFGA accepts. See [Archive ledger](/waggle/archive-ledger/).

### The four tables Kysely creates

`kysely_migration` / `kysely_migration_lock` / `kysely_seed` / `kysely_seed_lock`.

**Nobody designed these; Kysely creates and updates them.** The content is two
columns — which migration ran, and when — and the `_lock` tables hold a single
row each. The same runner is reused for migrations and seeds with nothing but
the table names changed.

## OpenFGA's database

**Read it if you like, but do not write to it.** A direct `INSERT` or `UPDATE`
will disagree with OpenFGA's cache and its `changelog`. Changes go through the
HTTP API.

```sh
# Reaching it takes container exec, since no port is published
container exec openfga-db.waggle psql -U openfga -d openfga -c "\dt"
```

### tuple

**The relationships themselves.** Almost everything OpenFGA stores is this one
table.

| Column                                 | Role                                |
| -------------------------------------- | ----------------------------------- |
| `store`                                | every row is partitioned by store   |
| `object_type` / `object_id`            | "on what", split across two columns |
| `relation`                             | in what relationship                |
| `_user`                                | "who" — not necessarily a person    |
| `user_type`                            | `user` vs `userset`                 |
| `condition_name` / `condition_context` | there only for conditioned tuples   |

The underscore in `_user` is because `user` is reserved in SQL. Real rows contain
things like `capture_job:…` and `organization:acme`, which is what "not
necessarily a person" means.

**There are indexes in two directions.**

- the primary key `(store, object_type, object_id, relation, _user)` — "who is
  attached to this object", which Check uses
- `idx_user_lookup (store, _user, relation, object_type, object_id)` — "what
  objects is this user attached to", used by ListObjects

The same data has to be read from both directions, so it needs both indexes.

### authorization_model

**The model. There is no update and no delete.** Every write mints a new id and
leaves the old rows in place; the whole model is serialized into
`serialized_protobuf`.

A Check that names an id evaluates against that version; omitting it always uses
the newest. **That is why `WAGGLE_FGA_MODEL_ID` is pinned** — without it, editing
the model would change every decision the moment it lands.

### changelog

**`tuple` only holds the current state** — deleted rows are gone. This table
keeps the history. `operation` is `0` for a write and `1` for a delete.

It exists for auditing (when a permission was granted and when it lapsed) and for
the Watch API.

### store

One OpenFGA can hold many stores. Tuples and models are partitioned by store, so
separate projects can share an instance.

:::caution[Deleting a store is a soft delete]
The API sets `deleted_at` and nothing else; `tuple` and `changelog` rows remain
(they just stop being visible through the API). Reclaiming the space takes SQL.
:::

### assertion

Where OpenFGA can store tests attached to a model — **waggle does not use it.**
The tests live in `fga/model.fga.yaml` and run in-process via
`pnpm run fga:test`, with no server, which is why CI can verify them without
bringing the stack up.

### goose_db_version

OpenFGA's own schema migrations, filled by `pnpm run fga:migrate`. It plays the
same role as waggle's `kysely_migration` — **each database tracking its own
migrations** is one more sign that they are separate things.

## Looking inside

```sh
# waggle's — the host psql also works (5432 is published)
container exec postgres.waggle psql -U waggle -d waggle -c "\dt"

# OpenFGA's — no published port, so container exec
container exec openfga-db.waggle psql -U openfga -d openfga -c "\d tuple"
```
