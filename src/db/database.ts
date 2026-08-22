/**
 * Kysely のデータベース型定義。
 *
 * Kysely の client が触るすべてのテーブルの列について、唯一の出どころ。
 * migration と seed は `Kysely<Database>` を通してこれを参照するので、
 * `insertInto` / `selectFrom` に型検査が効き、`CamelCasePlugin` が TS 側の
 * camelCase (`urlHash`) を DB 側の snake_case (`url_hash`) へ自動で写せる。
 *
 * `loadUrls` (`src/data/url-source.ts`) は意図して素の `pg.Pool` のままで、
 * この型に結びついていない —— 今日これを使うのは Kysely で動く bin スクリプト
 * (migrate / seed) だけ。
 */
import type { ColumnType, Generated, GeneratedAlways } from "kysely";

export interface UrlsTable {
  // BIGSERIAL —— node-pg は精度を落とさないために int8 を `string` で返す。
  id: Generated<string>;
  url: string;
  // GENERATED ALWAYS AS (digest(url, 'sha256')) STORED —— 書き込むことはない。
  urlHash: GeneratedAlways<Buffer>;
  labels: ColumnType<string[], string[] | undefined, string[]>;
  enabled: ColumnType<boolean, boolean | undefined, boolean>;
  // この URL がどの組織のために撮られるか。OpenFGA の tuple で使う
  // `organization:<id>` という識別子と一致する。`004` を見ること。
  orgId: ColumnType<string, string | undefined, string>;
  createdAt: ColumnType<Date, string | undefined, never>;
  updatedAt: ColumnType<Date, string | undefined, string>;
}

/**
 * BrowserHive が実際に生んだ WACZ 1 本。運ぶのは在り処と来歴だけ ——
 * 誰が読めるかは関係であり、関係は OpenFGA に在る。
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
 * 未処理の OpenFGA への書き込み。属するアーカイブの行と同じトランザクションで
 * 記録される。`003-create-fga-outbox` を見ること。
 */
export interface FgaOutboxTable {
  // BIGSERIAL —— node-pg は精度を落とさないために int8 を `string` で返す。
  id: Generated<string>;
  // OpenFGA への書き込みリクエスト 1 つ分そのまま: `{ writes: [...] }`。
  payload: ColumnType<unknown, string, string>;
  createdAt: ColumnType<Date, string | undefined, never>;
  processedAt: ColumnType<Date | null, string | null | undefined, string | null>;
  attempts: ColumnType<number, number | undefined, number>;
  lastError: ColumnType<string | null, string | null | undefined, string | null>;
}

/** その取り込みがどの組織のために投げられたか。`004` を見ること。 */
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
