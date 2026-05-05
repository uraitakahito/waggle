/**
 * Seed runner.
 *
 * Executes `db/seeds/sample.sql` against `DATABASE_URL`. The seed file
 * is idempotent (`ON CONFLICT (url_hash) DO NOTHING`), so it is safe
 * to re-run.
 *
 * Real deployments populate `urls` through their own pipeline; this
 * runner exists for local development and the prod-stack smoke test.
 */
import { readFile } from "node:fs/promises";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { logger } from "../logger.js";
import { createPool, redactDatabaseUrl } from "./pool.js";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const seedFile = path.join(projectRoot, "db", "seeds", "sample.sql");

const main = async (): Promise<void> => {
  const databaseUrl = process.env["DATABASE_URL"];
  if (!databaseUrl) {
    logger.fatal("DATABASE_URL is not set");
    process.exit(1);
  }

  logger.info({ database: redactDatabaseUrl(databaseUrl), file: seedFile }, "Seeding database");
  const sql = await readFile(seedFile, "utf-8");
  const pool = createPool(databaseUrl);
  try {
    await pool.query(sql);
    logger.info("Seed applied");
  } finally {
    await pool.end();
  }
};

main().catch((err: unknown) => {
  logger.fatal({ err }, "Seed failed");
  process.exit(1);
});
