/**
 * Migration CLI entry point.
 *
 * Runs Kysely migrations from `src/db/migrations/` (compiled to
 * `dist/db/migrations/`). Direction is a positional argument
 * (`up` | `down`); `DATABASE_URL` is required via env.
 *
 * Ledger lives in `kysely_migration` / `kysely_migration_lock`. The
 * older self-rolled `migrations` table from the SQL-runner era is
 * unused — clean environments have it absent, and existing dev
 * volumes are expected to be wiped before adopting this runner
 * (per the breaking-change scope).
 *
 * Invoked as `node dist/db/migrate.js <up|down>`.
 */
import { Argument, Command, Option } from "commander";
import { parsePath } from "./cli-parsers.js";
import { createKyselyClient } from "./kysely.js";
import { redactDatabaseUrl } from "./pool.js";
import { createChildLogger } from "../logger.js";
import { runMigratorCli } from "./migrator-runner.js";

const program = new Command();
program
  .name("migrate")
  .description("Run database migrations")
  .addArgument(new Argument("<direction>", "Migration direction").choices(["up", "down"]))
  .addOption(
    new Option("--migration-folder <path>", "Path to migration files directory")
      .env("MIGRATION_FOLDER")
      .default(new URL("./migrations/", import.meta.url))
      .argParser(parsePath),
  );

program.parse();

const direction = program.args[0] as "up" | "down";
const opts = program.opts<{ migrationFolder: URL }>();

const databaseUrl = process.env["DATABASE_URL"];
const cliLogger = createChildLogger({ command: "migrate", direction });
if (!databaseUrl) {
  cliLogger.fatal("DATABASE_URL is not set");
  process.exit(1);
}

cliLogger.info({ database: redactDatabaseUrl(databaseUrl) }, "Running migrations");

const kyselyClient = createKyselyClient(databaseUrl);
await runMigratorCli(
  "Migration",
  direction,
  {
    migrationFolder: opts.migrationFolder,
    migrationTableName: "kysely_migration",
    migrationLockTableName: "kysely_migration_lock",
  },
  kyselyClient,
  cliLogger,
);
