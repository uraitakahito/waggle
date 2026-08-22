/**
 * seed の CLI の入口。
 *
 * `migrate.ts` と同じ Kysely Migrator runner を、台帳テーブルだけ
 * `kysely_seed` / `kysely_seed_lock` に変えて使い回す。こうすると seed ファイルは
 * 環境ごとに高々 1 度しか当たらない。方向は位置引数 (`up` | `down`)。
 *
 * 実際の配備では `urls` を各自のパイプラインが埋める。この runner が在るのは
 * ローカルの開発と、本番構成の smoke test のため。
 *
 * `node dist/db/seed.js <up|down>` として起動する。
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
