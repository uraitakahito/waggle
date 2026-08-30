---
title: Archive ledger
description: How waggle records which WACZ exists, who may read it, and how it hands out signed URLs without ever giving away a bucket credential
---

waggle keeps a **ledger** of the archives BrowserHive produced, and issues
short-lived signed URLs for them to callers who are allowed to read them.

The parts:

|              | Holds                                        | Where             |
| ------------ | -------------------------------------------- | ----------------- |
| `archives`   | Where each WACZ is — bucket, key, provenance | waggle's Postgres |
| OpenFGA      | Who may read what, as relationships          | its own Postgres  |
| `fga_outbox` | Tuples waiting to be delivered to OpenFGA    | waggle's Postgres |

There is deliberately no owner column on `archives`. Who may read an archive is
a relationship, and keeping a second copy of that answer next to the first is
how the two start disagreeing.

## Why the outbox exists

Inserting an archive row and writing its relationship tuples touch two
different systems — Postgres and OpenFGA's HTTP API — and no transaction spans
both. Done independently, one can land without the other, and both halves are
bad: an archive nobody can reach, or a permission pointing at a row that was
rolled back.

So the tuple write is _recorded_ as an outbox row **inside the same transaction
as the archive**. Either both land or neither does. A worker delivers it
afterwards and retries until OpenFGA accepts it.

Delivery is at-least-once, and a tuple that is already there counts as
delivered.

:::caution[OpenFGA writes are transactional across the batch]
If any tuple in a write already exists, the _entire_ request is rejected and
nothing is written — including the tuples that were new. So a batch failure
cannot simply be read as "already delivered": the worker retries tuple by tuple
in that case, or the new tuples would be lost silently.
:::

## Filling the ledger

Two paths, on purpose.

**Polling** — `waggle` waits for each capture it submitted
(`GetCapture`, `PENDING` / `PROCESSING` until it finishes) and registers the ones
that produced an archive. Fast, but only works while waggle is running.
`--no-collect` skips it.

**Reconciling** — `waggle-ledger reconcile` walks the `.result.json` manifests
BrowserHive writes next to every capture's artifacts and registers anything the
ledger is missing. This is what makes the ledger self-healing: waggle can be
down for hours, or a result can age out of BrowserHive's cache before the
poller sees it, and the next reconcile still picks it up.

Polling is for latency. Reconciling is for correctness. A ledger with holes
nobody notices is worse than no ledger, because the holes only surface much
later as "why can't I see this archive?".

```sh
waggle-ledger reconcile   # fill gaps from the bucket
waggle-ledger drain       # deliver queued tuples (the API also does this on a timer)
```

Only successful captures enter the ledger. A failed one uploaded nothing, and
recording it would let the API hand out a URL for an object that is not there —
authorization working perfectly on a 404.

### Attribution

A manifest says nothing about organizations; BrowserHive has no such concept.
So `waggle` writes a `capture_submissions` row (task id → organization) when it
submits, and the reconciler reads it back. Encoding the organization inside
`correlationId` instead was rejected: a convention held only by agreement is
broken by the first caller who submits a capture by hand.

## Handing out URLs

`waggle-api` serves two endpoints. Both require an identity; see below.

```sh
# One archive
curl -X POST http://localhost:7070/api/archives/<id>/url
# → { "url": "http://…?X-Amz-Signature=…", "expiresIn": 300 }

# The ones you may see, newest first
curl http://localhost:7070/api/archives
```

A caller who may not read an archive gets **404, not 403**. A 403 would confirm
that the id names a real archive — the enumeration leak OWASP API1:2023
(Broken Object Level Authorization) warns about. "You may not see it" and "it
does not exist" have to be indistinguishable.

:::note[The signing call is the only enforcement point]
S3 checks a signature and nothing else, so once a URL is signed the decision is
made and cannot be withdrawn. Every check that is not immediately before
signing is advisory. This is also why the expiry is short: a signed URL cannot
be revoked, so its lifetime is the irreducible gap between removing someone's
access and that access actually ending.
:::

The single-archive check runs at `HIGHER_CONSISTENCY` — a cached "allow" here
would hand out a URL valid for its whole lifetime. The list does not: appearing
in a list grants nothing, since fetching any of them still has to pass the
strongly consistent check.

## Picking an archive in a browser

`waggle-api` also serves a picker at `/` — the list above, rendered, with each
row opening the archive in [replay](https://github.com/uraitakahito/replay).

```sh
pnpm run api                  # host-side; the stack has no waggle-api service
open http://127.0.0.1:7070/
```

This needs a filled-in `.env` — see [Setup](#setup). Without
`WAGGLE_DEV_IDENTITY=1` the API still starts, but the resolver denies everyone
and the picker stays empty on a `401`.

The picker hands replay the `objectKey` and nothing else:

```
http://127.0.0.1:8899/?source=/wacz/<objectKey>
```

Not the signed URL. A signed URL points straight at S3, which is a different
origin from the viewer, so the browser would need CORS on the bucket. The
object key goes through replay's own upstream, so **replay needs no change at
all**.

:::caution[The list is filtered; the read is not]
`can_view` decides what appears in the picker. It does **not** guard
`/wacz/<key>` — anyone who knows a key can read it, because that path is served
by the bucket's anonymous read. The filtering decides what you are shown, not
what you could fetch.

Closing that gap means handing out the signed URL instead and setting CORS on
the bucket, which is a separate change.
:::

## Identity

Authenticating the caller is a separate problem from authorizing them, and the
identity provider has not been chosen. What the authorization layer needs is
small — a subject and the organizations they belong to — so that shape is fixed
and the verification behind it is swappable.

**By default nobody is authenticated and every request is 401.** For local
development, `WAGGLE_DEV_IDENTITY=1` enables a resolver that trusts two
headers:

```sh
curl -X POST http://localhost:7070/api/archives/<id>/url \
  -H 'X-Waggle-Subject: bob' \
  -H 'X-Waggle-Organizations: acme'
```

Anyone who can reach the port can claim to be anyone. It refuses to run unless
switched on explicitly, and the server warns loudly at startup.

The CLI carries the same identity by a different route. There are no headers to
read there, so it takes two environment variables, `WAGGLE_DEV_SUBJECT` and
`WAGGLE_DEV_ORGANIZATIONS` (written into `.env` by `setup.sh`):

```sh
WAGGLE_DEV_SUBJECT=bob WAGGLE_DEV_ORGANIZATIONS=acme pnpm run dev --wacz
```

Nothing is verified here either — editing `.env` is enough to become anyone. It
is there because this is what becomes `capture_submissions.submitted_by` and the
`owner` tuple on the `capture_job`, and while those are empty **not even the
person who asked for the archive can delete it** (`can_delete` reads
`owner from parent` and nothing else).

There is no CLI equivalent of the API's `WAGGLE_DEV_IDENTITY=1` switch: the CLI
refuses to start when the variables are unset. The API opens a port, so its
default is to deny; the CLI is a tool you run yourself, and there the dangerous
default is the other one — passing silently with an empty subject and writing a
record that lies.

Both routes end at one function in `src/config/identity.ts`. That is the only
thing an identity provider replaces; callers see nothing but the `Identity` type.

Membership is **not** stored in OpenFGA. It is passed per request as a
contextual tuple built from the caller's identity, so joining or leaving an
organization never has to be synchronised into the authorization store. The
cost is that revocation waits for the token to expire — which is why tokens
should be short-lived.

## The authorization model

Four types, with ownership flowing downwards: **organization → job → archive**.

| Type           | Relations                                             |
| -------------- | ----------------------------------------------------- |
| `user`         | —                                                     |
| `organization` | `member` / `admin`                                    |
| `capture_job`  | `owner` / `parent` (organization) / `member`          |
| `archive`      | `parent` (job) / `viewer` / `can_view` / `can_delete` |

The signing endpoint asks exactly one question — `can_view` — and there are
three ways to reach it.

```
define can_view: viewer or owner from parent or member from parent
```

| Path                 | Who                               | Where it comes from                   |
| -------------------- | --------------------------------- | ------------------------------------- |
| `viewer`             | someone outside the organization  | a tuple (**always with an expiry**)   |
| `owner from parent`  | whoever asked for the job         | a tuple                               |
| `member from parent` | anyone in the owning organization | a **contextual tuple** from the token |

Deleting belongs to the owner alone (`can_delete: owner from parent`). **A
member of the organization can look but not destroy.**

:::note[`capture_job.member` is the missing hop]
It looks as though `archive` could reach `organization#member` directly. It
cannot: **`from` traverses exactly one edge**, and `archive#parent` points at a
`capture_job`, which puts organization membership two hops away.

```
type capture_job
  relations
    define parent: [organization]
    define member: member from parent   # ← the hop that closes the gap
```

:::

### A share lapses on its own

Nothing outside the organization can be shared without an expiry, because the
type of `viewer` is conditioned.

```
define viewer: [user with non_expired_grant, organization#member]

condition non_expired_grant(current_time: timestamp, grant_time: timestamp, grant_duration: duration) {
  current_time < grant_time + grant_duration
}
```

`current_time` is supplied on every Check, so **nothing has to sweep expired
tuples**. The tuple stays; the condition simply stops holding. A sweeper falling
behind cannot leave a hole open.

### What the assertions hold down

Each of the seven in `fga/model.fga.yaml` names a way someone could be let in
who should not be.

| #   | Question                                                        |
| --- | --------------------------------------------------------------- |
| 1   | the owner of the job can view what it produced                  |
| 2   | a member of the owning organization **can view but not delete** |
| 3   | an unrelated user sees nothing                                  |
| 4   | **membership in another organization grants nothing**           |
| 5   | a direct share is visible inside its window                     |
| 6   | **the same share has lapsed after its window**                  |
| 7   | a shared archive still cannot be deleted by the recipient       |

5 and 6 use **the identical tuple** and differ only in `current_time`.

### Verifying and deploying

`fga/model.fga` is the source of truth, with assertions in
`fga/model.fga.yaml` that run in CI:

```sh
pnpm run fga:test    # assertions, no server needed
pnpm run fga:deploy  # push the model, print the ids to pin
```

`fga:deploy` prints `WAGGLE_FGA_STORE_ID` and `WAGGLE_FGA_MODEL_ID`. **Pin the
model id.** Models are immutable and every write mints a new one; a client that
omits the id evaluates against whatever is newest, so editing the model would
change every decision the moment it lands. Bumping the variable is what makes
that switch deliberate.

## Setup

```sh
./setup.sh                    # writes .env from .env.example (25 variables)
container-compose up -d -b
pnpm run fga:migrate          # OpenFGA's schema (see below)
pnpm run db:migrate
pnpm run fga:deploy           # → paste the two ids it prints into .env
pnpm run api
```

Everything reads `.env` — the `pnpm run` scripts pass
`--env-file-if-exists=.env`. Seven variables are mandatory and two of them
(`WAGGLE_FGA_STORE_ID`, `WAGGLE_FGA_MODEL_ID`) do not exist until `fga:deploy`
has run, which is why that step comes before `api`. `scripts/check-env.mjs`
keeps `.env.example` in step with what the code actually reads.

:::caution[`fga:migrate` is a separate step]
The `openfga` image is distroless, so it cannot run a shell retry loop as its
entrypoint the way seaweedfs does, and container-compose has no one-shot
service. The server starts fine against an unmigrated database and answers
**500 on everything, including `/healthz`**, until this has run.

Its datastore is also configured with command-line flags rather than env vars:
container-compose injects Docker-link-style variables that OpenFGA's config
loader picks up and misreads — supplying the datastore through the environment
made it panic with `storage engine '192.168.64.202' is unsupported`, the
database container's IP.
:::
