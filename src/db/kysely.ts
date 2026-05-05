/**
 * Kysely client factory.
 *
 * Wraps `pg.Pool` (built from a `DATABASE_URL` connection string) with
 * Kysely's `PostgresDialect` and the `CamelCasePlugin`, which maps TS
 * camelCase identifiers (`urlHash`, `createdAt`) to DB snake_case
 * (`url_hash`, `created_at`).
 *
 * Query logging is bridged into the project's pino logger as a child
 * logger bound to `module: "kysely"`. Errors always log; successful
 * queries log only when the root logger is at `debug` or below.
 *
 * The returned client owns its underlying pool — call `.destroy()` on
 * the client (the migrator-runner does this) to end the pool. Callers
 * should not invoke `pool.end()` separately.
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
