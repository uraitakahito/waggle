#!/usr/bin/env node
/**
 * 台帳の保守コマンド。
 *
 * `waggle` (取り込みの client) と分けているのは、これらが仕事を投げるのではなく
 * 台帳を操作するものだから。そして両方とも、別のどこかからタイマーで走らせると
 * 役に立つから。`waggle` は目的が 1 つのコマンドのままにしておく。
 *
 *   waggle-ledger drain      積まれた tuple を OpenFGA へ配送する
 *   waggle-ledger reconcile  bucket の manifest から台帳の穴を埋める
 */
import { Command, Option } from "commander";
import { fgaConfig, storageConfig } from "../config/env.js";
import { createKyselyClient } from "../db/kysely.js";
import { createFgaClient } from "./client.js";
import { drainOutbox } from "./outbox-worker.js";
import { createS3Client } from "../archive/s3.js";
import { reconcile } from "../archive/reconcile.js";
import { fatal, logger } from "../logger.js";

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

program.parseAsync(process.argv).catch(fatal);
