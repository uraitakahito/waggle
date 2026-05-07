# Architecture

## Upstream version pinning

waggle is pinned to **BrowserHive `1.3.0`**. Three places carry this version and must move together when bumping:

1. `package.json#openapi:sync` (URL contains `refs/tags/1.3.0/...`) — drives `openapi/browserhive.yaml` and the generated SDK under `src/http/generated/`.
2. `setup.sh#BROWSERHIVE_VERSION` — drives the `etc/seaweedfs/*` download and the `BROWSERHIVE_REF` line written to `.env`.
3. `compose.{dev,prod}.yaml` — `BROWSERHIVE_REF:-1.3.0` default in the `browserhive` service `build.context`.

See [`docs/development.md`](development.md#upgrading-browserhive) for the upgrade procedure.

## Stage 0 (current)

```
   ┌──────────────────────┐
   │ Postgres (urls)      │
   │  id, url, url_hash,  │
   │  labels[], enabled   │
   └──────────┬───────────┘
              │ SELECT url, labels
              ▼
   ┌──────────────────────────────────────────────┐
   │ waggle (Node 24 / TypeScript / commander)    │
   │  ┌────────────────┐  ┌───────────────────┐   │
   │  │ url-source     │─▶│ cli-options       │   │
   │  │ (pg query)     │  └─────────┬─────────┘   │
   │  └────────────────┘            ▼             │
   │  ┌────────────────────────────────────────┐  │
   │  │ run.ts  ──▶  submit.ts (parallel)      │  │
   │  └─────────────────┬──────────────────────┘  │
   │                    ▼                         │
   │      @hey-api/openapi-ts SDK (fetch)         │
   └────────────────────┬─────────────────────────┘
                        │ HTTP POST /v1/captures
                        ▼
        ┌──────────────────────────────────────┐
        │ BrowserHive 1.3.0 (port 8080)        │
        │   coordinator + worker pool          │
        └─────┬─────────────────┬─────────┬────┘
              │ CDP 9222        │ CDP     │ S3 PutObject
              ▼                 ▼         ▼
   ┌──────────────────┐ ┌──────────────────┐ ┌────────────────────┐
   │ chromium-server-1│ │ chromium-server-2│ │ seaweedfs          │
   │   noVNC :6080    │ │   noVNC :6081    │ │  S3 endpoint :8333 │
   │                  │ │                  │ │  bucket browserhive│
   └──────────────────┘ └──────────────────┘ └────────────────────┘
```

waggle's interaction model is **fire-and-forget**: every enabled row in the `urls` table is POSTed to `/v1/captures`. BrowserHive returns 202 + `taskId` and processes the capture asynchronously on its worker pool. Stage 0 records 202s and rejections, then exits.

Captured artefacts (PNG / WebP / HTML / `.links.json` / PDF / MHTML) are uploaded by BrowserHive to the configured S3 bucket as `s3://<bucket>/[<keyPrefix>/]<filename>`. Both compose stacks bundle a self-hosted **SeaweedFS** as the default backend; override `BROWSERHIVE_S3_ENDPOINT` to point at AWS S3, Cloudflare R2, or any MinIO-compatible managed service.

## URL source schema

`src/db/migrations/001-create-urls.ts` (Kysely Migrator):

| Column     | Type          | Notes                                                            |
| ---------- | ------------- | ---------------------------------------------------------------- |
| id         | BIGSERIAL PK  | Insertion order is preserved by `ORDER BY id ASC` at query time. |
| url        | TEXT NOT NULL | `CHECK (url <> '' AND url = btrim(url))` — invariant held by DB. |
| url_hash   | BYTEA STORED  | `digest(url, 'sha256')` (pgcrypto). Backs the unique index.      |
| labels     | TEXT[]        | Mirrors the YAML `labels:` field used for filename composition.  |
| enabled    | BOOLEAN       | Hot-path query is `WHERE enabled` — covered by a partial index.  |
| created_at | TIMESTAMPTZ   | `now()` default.                                                 |
| updated_at | TIMESTAMPTZ   | `now()` default. No auto-update trigger today.                   |

`urls_url_hash_key` (unique) ensures no duplicate URLs by SHA-256. `urls_enabled_id_idx` is a partial index on `id WHERE enabled` covering the loader's hot path.

The waggle CLI itself never inserts into `urls` — population is the caller's responsibility (manual `INSERT`s, an external pipeline, or `npm run db:seed` for the bundled fixture).

## Network layout

All Compose services share the `chromium-network` bridge:

| Service           | Container hostname  | Container port    | Host port (`compose.dev.yaml`)                                                                           |
| ----------------- | ------------------- | ----------------- | -------------------------------------------------------------------------------------------------------- |
| chromium-server-1 | `chromium-server-1` | 9222 (CDP)        | 9222                                                                                                     |
| chromium-server-1 | `chromium-server-1` | 6080 (noVNC)      | 6080                                                                                                     |
| chromium-server-2 | `chromium-server-2` | 9222 (CDP)        | 9223                                                                                                     |
| chromium-server-2 | `chromium-server-2` | 6080 (noVNC)      | 6081                                                                                                     |
| seaweedfs         | `seaweedfs`         | 8333 (S3 API)     | (none — internal only on both dev and prod)                                                              |
| seaweedfs         | `seaweedfs`         | 8888 (Filer HTTP) | (none — internal only)                                                                                   |
| seaweedfs         | `seaweedfs`         | 9333 (master)     | (none — internal only; init service uses gRPC here)                                                      |
| browserhive       | `browserhive`       | 8080 (HTTP)       | `${BROWSERHIVE_HOST_PORT:-8080}`                                                                         |
| postgres          | `postgres`          | 5432              | `${POSTGRES_HOST_PORT:-5432}` (dev only — prod stack does not publish the port)                          |
| waggle            | `waggle`            | (no listener)     | dev: long-running shell on `compose.dev.yaml`; prod: one-shot via `--profile run` on `compose.prod.yaml` |

`compose.prod.yaml` strips the noVNC + Postgres host ports (chromium servers and the database are internal-only) and uses headless chromium-server-docker images. The prod stack also adds `waggle-migrator` and `waggle-seeder` one-shot services that run before `waggle` in the `--profile run` flow, so `urls` is populated by the time the CLI queries it. `seaweedfs-init` (a one-shot bucket bootstrap) runs before `browserhive` in both stacks so the configured bucket exists by the time the first capture is uploaded.
