---
title: capture_submissions
description: Records who a capture was submitted for, at the moment it is submitted.
---

**This records who a capture was submitted for, at the moment it is submitted.**

```ts file="src/db/migrations/004-create-capture-submissions.ts#capture-submissions-columns"

```

## Why it is needed

**BrowserHive has no notion of an organization.** waggle passes it a URL and some
settings, and gets back a `taskId`.

When the ledger is later filled from a `.result.json` in the bucket, **that
manifest carries nothing identifying an organization**. Writing it down at
submission time is the only source.

```
what waggle knows          what BrowserHive knows
─────────────────          ──────────────────────
urls.org_id       ──┐      taskId
                    │      where the artifacts are
                    └──→   (no idea about organizations)
              capture_submissions
              maps task_id → org_id
```

Without this row the reconciler cannot say who an archive belongs to.

## How it is written

`run.ts` writes once for all accepted submissions.

```ts
await db
  .insertInto("captureSubmissions")
  .values(accepted.map((r) => ({ taskId: r.taskId, orgId: r.orgId, ... })))
  .onConflict((oc) => oc.column("taskId").doNothing())
  .execute();
```

**It is written before waiting on the captures begins**, so attribution survives
the process dying mid-wait.

A `taskId` is never resubmitted (the server mints it), but **this function can be
re-run**, hence `onConflict … doNothing()`.

## How it is read

`reconcile.ts` reads it while filling the ledger from bucket manifests.

```
read taskId from .result.json
  → look up org_id in capture_submissions
  → register in archives, and queue tuples with that org_id
```

## Column notes

| Column         | Note                                                                                                                    |
| -------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `task_id`      | **Primary key.** BrowserHive's id, the join back to the result report                                                   |
| `org_id`       | `not null`. **The reason this table exists**                                                                            |
| `submitted_by` | The user who asked, when there was one. **NULL for scheduled runs that belong to an organization rather than a person** |
| `source_url`   | Not a foreign key to `urls` — the row survives the URL being removed                                                    |
| `submitted_at` | Default `now()`                                                                                                         |

:::note[The counts will not match the ledger]
Everything submitted lands here, but only captures that **produced an archive**
land in [`archives`](/waggle/databases/archives/). A failed capture uploaded
nothing, so a gap is expected.
:::
