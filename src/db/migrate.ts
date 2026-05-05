/**
 * Migration runner.
 *
 * Applies SQL files under `db/migrations/` in alphabetical order,
 * tracking applied IDs in a `migrations` ledger table. Idempotent:
 * already-applied migrations are skipped.
 *
 * Each migration runs in a transaction wrapped around a single
 * `client.query()` call — Postgres allows multi-statement strings via
 * the simple-query protocol when no parameters are bound, which is the
 * shape our migrations need.
 *
 * Invoked as `node dist/db/migrate.js` (no args). Reads
 * `DATABASE_URL` from the environment.
 */
import { readdir, readFile } from "node:fs/promises";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { logger } from "../logger.js";
import { createPool, redactDatabaseUrl } from "./pool.js";

// dist/db/migrate.js -> project root
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const migrationsDir = path.join(projectRoot, "db", "migrations");

const ensureLedger = async (pool: import("pg").Pool): Promise<void> => {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS migrations (
      id          TEXT        PRIMARY KEY,
      applied_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
};

const listAppliedIds = async (pool: import("pg").Pool): Promise<Set<string>> => {
  const result = await pool.query<{ id: string }>("SELECT id FROM migrations");
  return new Set(result.rows.map((row) => row.id));
};

const listMigrationFiles = async (): Promise<string[]> => {
  const entries = await readdir(migrationsDir);
  return entries.filter((name) => name.endsWith(".sql")).sort();
};

const applyMigration = async (pool: import("pg").Pool, fileName: string): Promise<void> => {
  const filePath = path.join(migrationsDir, fileName);
  const sql = await readFile(filePath, "utf-8");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(sql);
    await client.query("INSERT INTO migrations (id) VALUES ($1)", [fileName]);
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
};

const main = async (): Promise<void> => {
  const databaseUrl = process.env["DATABASE_URL"];
  if (!databaseUrl) {
    logger.fatal("DATABASE_URL is not set");
    process.exit(1);
  }

  logger.info({ database: redactDatabaseUrl(databaseUrl) }, "Running migrations");
  const pool = createPool(databaseUrl);
  try {
    await ensureLedger(pool);
    const applied = await listAppliedIds(pool);
    const files = await listMigrationFiles();
    const pending = files.filter((name) => !applied.has(name));

    if (pending.length === 0) {
      logger.info({ total: files.length }, "No pending migrations");
      return;
    }

    for (const fileName of pending) {
      logger.info({ migration: fileName }, "Applying migration");
      await applyMigration(pool, fileName);
    }
    logger.info({ applied: pending.length, total: files.length }, "Migrations applied");
  } finally {
    await pool.end();
  }
};

main().catch((err: unknown) => {
  logger.fatal({ err }, "Migration failed");
  process.exit(1);
});
