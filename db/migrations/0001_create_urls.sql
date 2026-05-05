-- 0001_create_urls.sql
--
-- Creates the `urls` table that backs waggle's URL source.
--
-- `url_hash` is a SHA-256 of `url`, computed by pgcrypto's `digest()` and
-- stored as a generated column so the unique index covers it without
-- application-side hashing. Use `digest()` (binary) rather than
-- `encode(digest(...), 'hex')` so the index is on the raw 32-byte BYTEA
-- (smaller, faster) — callers should never need to read the hash directly.
--
-- `labels TEXT[]` mirrors the YAML `labels:` field used for filename
-- composition downstream (`{taskId}_{correlationId}_{labels}.{ext}`).

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE urls (
    id          BIGSERIAL    PRIMARY KEY,
    url         TEXT         NOT NULL CHECK (url <> '' AND url = btrim(url)),
    url_hash    BYTEA        GENERATED ALWAYS AS (digest(url, 'sha256')) STORED,
    labels      TEXT[]       NOT NULL DEFAULT '{}',
    enabled     BOOLEAN      NOT NULL DEFAULT TRUE,
    created_at  TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX urls_url_hash_key ON urls (url_hash);

-- Partial index: waggle's hot path is `WHERE enabled ORDER BY id`. Indexing
-- the disabled rows is wasted space.
CREATE INDEX urls_enabled_id_idx ON urls (id) WHERE enabled;
