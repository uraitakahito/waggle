/**
 * Kysely の client を作る。
 *
 * `DATABASE_URL` の接続文字列から作った `pg.Pool` を、Kysely の
 * `PostgresDialect` と `CamelCasePlugin` で包む。plugin が TS 側の camelCase の
 * 識別子 (`urlHash`、`createdAt`) を DB 側の snake_case (`url_hash`、
 * `created_at`) へ写す。
 *
 * クエリのログは、`module: "kysely"` を binding した child logger として
 * このプロジェクトの pino に橋渡しする。エラーは常に出し、成功したクエリは
 * root logger が `debug` 以下のときだけ出す。
 *
 * 返す client は下にある pool を所有する —— pool を終わらせるには client の
 * `.destroy()` を呼ぶこと (migrator-runner がそうしている)。呼ぶ側が別途
 * `pool.end()` を呼んではいけない。
 */
import pg from "pg";
import type { LogEvent } from "kysely";
import { CamelCasePlugin, Kysely, PostgresDialect } from "kysely";
import { createChildLogger } from "../logger.js";
import type { Database } from "./database.js";

const kyselyLogger = createChildLogger({ module: "kysely" });

const kyselyLog = (event: LogEvent): void => {
  if (event.level === "error") {
    kyselyLogger.error(
      { sql: event.query.sql, durationMs: event.queryDurationMillis, err: event.error },
      "Query error",
    );
  } else if (kyselyLogger.isLevelEnabled("debug")) {
    kyselyLogger.debug(
      { sql: event.query.sql, durationMs: event.queryDurationMillis },
      "Query executed",
    );
  }
};

export const createKyselyClient = (databaseUrl: string): Kysely<Database> => {
  const dialect = new PostgresDialect({
    pool: new pg.Pool({ connectionString: databaseUrl }),
  });
  return new Kysely<Database>({
    dialect,
    plugins: [new CamelCasePlugin()],
    log: kyselyLog,
  });
};
