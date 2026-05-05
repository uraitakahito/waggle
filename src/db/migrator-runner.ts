/**
 * Generic Kysely Migrator runner.
 *
 * Same shape as contact-api's `migrator-runner.ts`: a thin wrapper
 * around `Migrator` + `FileMigrationProvider` that the `migrate` and
 * `seed` CLIs reuse with different `migrationTableName` /
 * `migrationLockTableName` / `migrationFolder` triples.
 *
 * Side-effect-free apart from logging and `process.exitCode` — the
 * Kysely client and logger are passed in. `runMigratorCli` always
 * `.destroy()`s the client at the end so the underlying pg.Pool ends
 * and the process exits cleanly.
 */
import { promises as fs } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { FileMigrationProvider, Migrator } from "kysely";
import type { Kysely, MigrationInfo, MigrationResultSet } from "kysely";
import type { Logger } from "../logger.js";

export interface KyselyMigratorConfig {
  readonly migrationFolder: URL;
  readonly migrationTableName: string;
  readonly migrationLockTableName: string;
}

const createMigrator = (
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Kysely's Migrator requires Kysely<any>
  kyselyClient: Kysely<any>,
  config: KyselyMigratorConfig,
): Migrator =>
  new Migrator({
    db: kyselyClient,
    provider: new FileMigrationProvider({
      fs,
      path,
      migrationFolder: fileURLToPath(config.migrationFolder),
    }),
    migrationTableName: config.migrationTableName,
    migrationLockTableName: config.migrationLockTableName,
  });

export const runMigrator = async (
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Kysely's Migrator requires Kysely<any>
  kyselyClient: Kysely<any>,
  config: KyselyMigratorConfig,
  direction: "up" | "down",
): Promise<MigrationResultSet> => {
  const migrator = createMigrator(kyselyClient, config);
  return direction === "down" ? migrator.migrateDown() : migrator.migrateToLatest();
};

export const getMigrationInfos = async (
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Kysely's Migrator requires Kysely<any>
  kyselyClient: Kysely<any>,
  config: KyselyMigratorConfig,
): Promise<readonly MigrationInfo[]> => {
  const migrator = createMigrator(kyselyClient, config);
  return migrator.getMigrations();
};

export const runMigratorCli = async (
  label: string,
  direction: "up" | "down",
  migratorConfig: KyselyMigratorConfig,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Kysely's Migrator requires Kysely<any>
  kyselyClient: Kysely<any>,
  cliLogger: Logger,
): Promise<void> => {
  const { error, results } = await runMigrator(kyselyClient, migratorConfig, direction);

  for (const result of results ?? []) {
    if (result.status === "Success") {
      cliLogger.info(
        { migration: result.migrationName },
        `${label} "${result.migrationName}" was ${direction === "down" ? "reverted" : "executed"} successfully`,
      );
    } else if (result.status === "Error") {
      cliLogger.error(
        { migration: result.migrationName },
        `Failed to ${direction === "down" ? "revert" : "execute"} ${label.toLowerCase()} "${result.migrationName}"`,
      );
    }
  }

  if (results?.length === 0) {
    cliLogger.info(`No pending ${label.toLowerCase()} to execute`);

    if (cliLogger.isLevelEnabled("debug")) {
      const infos = await getMigrationInfos(kyselyClient, migratorConfig);
      if (infos.length > 0) {
        cliLogger.info(`${label} status:`);
        for (const info of infos) {
          if (info.executedAt) {
            cliLogger.info(
              { name: info.name, executedAt: info.executedAt.toISOString() },
              `${info.name} applied`,
            );
          } else {
            cliLogger.info({ name: info.name }, `${info.name} not applied`);
          }
        }
      }
    }
  }

  if (error) {
    cliLogger.error(
      { err: error },
      `Failed to ${label.toLowerCase()}${direction === "down" ? " down" : ""}`,
    );
    process.exitCode = 1;
  }

  await kyselyClient.destroy();
};
