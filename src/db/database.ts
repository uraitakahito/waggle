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
  // Which organization this URL is captured for. Agrees with the
  // `organization:<id>` identifiers used in OpenFGA tuples. See `004`.
  orgId: ColumnType<string, string | undefined, string>;
  createdAt: ColumnType<Date, string | undefined, never>;
  updatedAt: ColumnType<Date, string | undefined, string>;
}

/**
 * One WACZ that BrowserHive actually produced. Location and provenance only —
 * who may read it is a relationship, and relationships live in OpenFGA.
 */
export interface ArchivesTable {
  id: Generated<string>;
  taskId: string;
  correlationId: string | null;
  bucket: string;
  objectKey: string;
  sourceUrl: string;
  labels: ColumnType<string[], string[] | undefined, string[]>;
  waczComplete: boolean | null;
  capturedAt: ColumnType<Date, string, string>;
  createdAt: ColumnType<Date, string | undefined, never>;
}

/**
 * Pending OpenFGA writes, recorded in the same transaction as the archive row
 * they belong to. See `003-create-fga-outbox`.
 */
export interface FgaOutboxTable {
  // BIGSERIAL — node-pg returns int8 as `string` to avoid precision loss.
  id: Generated<string>;
  // A whole OpenFGA write request: `{ writes: [...] }`.
  payload: ColumnType<unknown, string, string>;
  createdAt: ColumnType<Date, string | undefined, never>;
  processedAt: ColumnType<Date | null, string | null | undefined, string | null>;
  attempts: ColumnType<number, number | undefined, number>;
  lastError: ColumnType<string | null, string | null | undefined, string | null>;
}

/** Which organization a capture was submitted for. See `004`. */
export interface CaptureSubmissionsTable {
  taskId: string;
  correlationId: string | null;
  orgId: string;
  submittedBy: string | null;
  sourceUrl: string;
  submittedAt: ColumnType<Date, string | undefined, never>;
}

export interface Database {
  urls: UrlsTable;
  archives: ArchivesTable;
  fgaOutbox: FgaOutboxTable;
  captureSubmissions: CaptureSubmissionsTable;
}
