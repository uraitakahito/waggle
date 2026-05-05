/**
 * Seed CLI entry point.
 *
 * Reuses the same Kysely Migrator runner as `migrate.ts`, with
 * `kysely_seed` / `kysely_seed_lock` ledger tables so seed files are
 * applied at most once per environment. Direction is a positional
 * argument (`up` | `down`).
 *
 * Real deployments populate `urls` through their own pipeline; this
 * runner exists for local development and the prod-stack smoke test.
 *
 * Invoked as `node dist/db/seed.js <up|down>`.
 */
import { Argument, Command, Option } from "commander";
import { parsePath } from "./cli-parsers.js";
import { createKyselyClient } from "./kysely.js";
import { redactDatabaseUrl } from "./pool.js";
import { createChildLogger } from "../logger.js";
import { runMigratorCli } from "./migrator-runner.js";

const program = new Command();
program
  .name("seed")
  .description("Run database seeds")
  .addArgument(new Argument("<direction>", "Seed direction").choices(["up", "down"]))
  .addOption(
    new Option("--seed-folder <path>", "Path to seed files directory")
      .env("SEED_FOLDER")
      .default(new URL("./seeds/", import.meta.url))
      .argParser(parsePath),
  );

program.parse();

const direction = program.args[0] as "up" | "down";
const opts = program.opts<{ seedFolder: URL }>();

const databaseUrl = process.env["DATABASE_URL"];
const cliLogger = createChildLogger({ command: "seed", direction });
if (!databaseUrl) {
  cliLogger.fatal("DATABASE_URL is not set");
  process.exit(1);
}

cliLogger.info({ database: redactDatabaseUrl(databaseUrl) }, "Seeding database");

const kyselyClient = createKyselyClient(databaseUrl);
await runMigratorCli(
  "Seed",
  direction,
  {
    migrationFolder: opts.seedFolder,
    migrationTableName: "kysely_seed",
    migrationLockTableName: "kysely_seed_lock",
  },
  kyselyClient,
  cliLogger,
);
