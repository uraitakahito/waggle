---
title: tuple
description: What OpenFGA actually stores. The two index directions are where the design shows.
---

**The relationships themselves.** Almost everything OpenFGA stores is this one
table.

:::caution[Read it, but do not write to it]
A direct `INSERT` or `UPDATE` will disagree with OpenFGA's cache and its
`changelog`. **Changes go through the HTTP API (Write).** Reading it in SQL is
for understanding what is inside.
:::

```sql
 store             | text        -- every row is partitioned by store
 object_type       | text        -- ┐
 object_id         | text        -- │ "on what", split across two columns
 relation          | text        -- │
 _user             | text        -- ┘ "who" (not necessarily a person)
 user_type         | text        -- 'user' / 'userset'
 ulid              | text        -- preserves write order
 inserted_at       | timestamptz
 condition_name    | text        -- ┐ there only for conditioned tuples
 condition_context | bytea       -- ┘
```

The underscore in `_user` is because **`user` is reserved in SQL**.

## "Who" is not necessarily a person

waggle's real rows show it:

```
 object                    | relation | _user
---------------------------+----------+---------------------------
 archive:c36c4879-…        | parent   | capture_job:89b1dcb5-…
 capture_job:89b1dcb5-…    | parent   | organization:acme
 archive:6ef44ae1-…        | parent   | capture_job:89b1dcb5-…
```

`_user` holds `capture_job` and `organization`. **The column is the subject of a
relationship, not a person field** — which is how parent-child links fit in the
same table.

## Indexes in two directions

```sql
tuple_pkey       PRIMARY KEY (store, object_type, object_id, relation, _user)
idx_user_lookup  (store, _user, relation, object_type, object_id)

idx_tuple_partial_user     … WHERE user_type = 'user'
idx_tuple_partial_userset  … WHERE user_type = 'userset'
idx_tuple_ulid   UNIQUE (ulid)
```

| Index             | Ordering                 | Question it answers                       | Used by     |
| ----------------- | ------------------------ | ----------------------------------------- | ----------- |
| `tuple_pkey`      | object → relation → user | **who is attached to this object**        | Check       |
| `idx_user_lookup` | user → relation → object | **what objects is this user attached to** | ListObjects |

**The same data has to be read from both directions, so it needs both indexes.**
That is part of the cost of implementing ReBAC.

## Conditions are columns

`condition_name` / `condition_context` show that **a "share for 7 days" condition
attaches to the tuple itself**, not to a separate table. Conditioned and plain
relationships live side by side.

In waggle's model only the direct share outside an organization is conditioned:

```
define viewer: [user with non_expired_grant, organization#member]
```

## How Check reads this table

OpenFGA **does not precompute a table of who can see what**. It walks this one,
per question.

```
"can alice view archive:X?"
  → what is archive:X's parent?   …… read a tuple
  → who owns that capture_job?    …… read a tuple
  → who is in that organization?  …… a contextual tuple (never stored)
```

Which is why **there is a depth limit**. Measured on v1.10.2 here, depth 25 still
answers and 26 returns `authorization_model_resolution_too_complex`.

## Looking inside

```sh
container exec openfga-db.waggle psql -U openfga -d openfga -c "\d tuple"

container exec openfga-db.waggle psql -U openfga -d openfga \
  -c "SELECT object_type||':'||object_id AS object, relation, _user FROM tuple"
```
