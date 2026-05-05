/**
 * Kysely database type definitions.
 *
 * Single source of truth for the columns of every table the Kysely
 * client touches. Migrations and seeds reference this through
 * `Kysely<Database>` so that `insertInto` / `selectFrom` get full
 * type-checking and the `CamelCasePlugin` can map TS-side camelCase
 * (`urlHash`) to DB-side snake_case (`url_hash`) automatically.
 *
 * `loadUrls` (`src/data/url-source.ts`) intentionally still uses raw
 * `pg.Pool` and is not coupled to this type — only the Kysely-driven
 * bin scripts (migrate / seed) consume it today.
 */
import type { ColumnType, Generated, GeneratedAlways } from "kysely";

export interface UrlsTable {
  // BIGSERIAL — node-pg returns int8 as `string` to avoid precision loss.
  id: Generated<string>;
  url: string;
  // GENERATED ALWAYS AS (digest(url, 'sha256')) STORED — never written.
  urlHash: GeneratedAlways<Buffer>;
  labels: ColumnType<string[], string[] | undefined, string[]>;
  enabled: ColumnType<boolean, boolean | undefined, boolean>;
  createdAt: ColumnType<Date, string | undefined, never>;
  updatedAt: ColumnType<Date, string | undefined, string>;
}

export interface Database {
  urls: UrlsTable;
}
