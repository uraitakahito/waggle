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

Membership is **not** stored in OpenFGA. It is passed per request as a
contextual tuple built from the caller's identity, so joining or leaving an
organization never has to be synchronised into the authorization store. The
cost is that revocation waits for the token to expire — which is why tokens
should be short-lived.

## The authorization model

`fga/model.fga` is the source of truth, with assertions in
`fga/model.fga.yaml` that run in CI:

```sh
npm run fga:test     # assertions, no server needed
npm run fga:deploy   # push the model, print the ids to pin
```

`fga:deploy` prints `WAGGLE_FGA_STORE_ID` and `WAGGLE_FGA_MODEL_ID`. **Pin the
model id.** Models are immutable and every write mints a new one; a client that
omits the id evaluates against whatever is newest, so editing the model would
change every decision the moment it lands. Bumping the variable is what makes
that switch deliberate.

## Setup

```sh
container-compose up -d -b
npm run fga:migrate          # OpenFGA's schema (see below)
npm run db:migrate
npm run fga:deploy           # → export the two ids it prints
npm run api
```

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
