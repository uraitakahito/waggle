#!/usr/bin/env node
/**
 * Ledger maintenance commands.
 *
 * Separate from `waggle` (the capture client) because these operate on the
 * ledger rather than submitting work, and because both are useful to run on a
 * timer from somewhere else. `waggle` stays a single-purpose command.
 *
 *   waggle-ledger drain      deliver queued tuples to OpenFGA
 *   waggle-ledger reconcile  fill ledger gaps from the bucket's manifests
 */
import { Command, Option } from "commander";
import { fgaConfig, storageConfig } from "../config/env.js";
import { createKyselyClient } from "../db/kysely.js";
import { createFgaClient } from "./client.js";
import { drainOutbox } from "./outbox-worker.js";
import { createS3Client } from "../archive/s3.js";
import { reconcile } from "../archive/reconcile.js";
import { logger } from "../logger.js";

const databaseUrlOption = new Option("--database-url <url>", "Postgres connection string")
  .env("DATABASE_URL")
  .makeOptionMandatory(true);

const runDrain = async (databaseUrl: string): Promise<void> => {
  const db = createKyselyClient(databaseUrl);
  try {
    const result = await drainOutbox(db, createFgaClient(fgaConfig()));
    logger.info(result, "Drain finished");
  } finally {
    await db.destroy();
  }
};

const runReconcile = async (databaseUrl: string): Promise<void> => {
  const storage = storageConfig();
  const db = createKyselyClient(databaseUrl);
  try {
    const result = await reconcile(db, createS3Client(storage), storage.bucket);
    logger.info(result, "Reconcile finished");
  } finally {
    await db.destroy();
  }
};

const program = new Command()
  .name("waggle-ledger")
  .description("Maintain waggle's archive ledger and its OpenFGA tuples")
  .showHelpAfterError(true);

program
  .command("drain")
  .description("Deliver queued relationship tuples from fga_outbox to OpenFGA")
  .addOption(databaseUrlOption)
  .action(async (opts: { databaseUrl: string }) => {
    await runDrain(opts.databaseUrl);
  });

program
  .command("reconcile")
  .description("Register any capture whose manifest is in the bucket but missing from the ledger")
  .addOption(databaseUrlOption)
  .action(async (opts: { databaseUrl: string }) => {
    await runReconcile(opts.databaseUrl);
  });

program.parseAsync(process.argv).catch((error: unknown) => {
  logger.fatal({ err: error }, "Fatal error");
  process.exit(1);
});
