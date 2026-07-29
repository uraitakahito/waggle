#!/usr/bin/env node
/**
 * The archive API: the only thing that hands out signed URLs.
 *
 * Also drains the outbox on a timer. Running it in-process rather than as a
 * separate service is safe because `drainOutbox` takes `FOR UPDATE SKIP
 * LOCKED` — several API instances, plus a manual `waggle-ledger drain`, can
 * all run without stepping on each other.
 */
import Fastify from "fastify";
import { Command, Option } from "commander";
import { fgaConfig, storageConfig } from "../config/env.js";
import { createKyselyClient } from "../db/kysely.js";
import { createFgaClient } from "../fga/client.js";
import { drainOutbox } from "../fga/outbox-worker.js";
import { createS3Client } from "../archive/s3.js";
import { resolveIdentityResolver } from "./identity.js";
import { registerRoutes } from "./routes.js";
import { logger } from "../logger.js";

const DEFAULT_PORT = 7070;
const DEFAULT_DRAIN_INTERVAL_MS = 5_000;

interface ServerOptions {
  databaseUrl: string;
  port: number;
  drainIntervalMs: number;
}

const parsePort = (value: string): number => {
  const port = Number.parseInt(value, 10);
  if (Number.isNaN(port) || port < 1 || port > 65_535) {
    throw new Error("--port must be between 1 and 65535");
  }
  return port;
};

const start = async (options: ServerOptions): Promise<void> => {
  const storage = storageConfig();
  const db = createKyselyClient(options.databaseUrl);
  const fga = createFgaClient(fgaConfig());
  const s3 = createS3Client(storage);
  const resolveIdentity = resolveIdentityResolver();

  if (process.env["WAGGLE_DEV_IDENTITY"] === "1") {
    logger.warn(
      "WAGGLE_DEV_IDENTITY=1 — callers are trusted on the X-Waggle-Subject header. Never enable this outside local development.",
    );
  }

  const app = Fastify({ logger: false });
  registerRoutes(app, { db, fga, s3, resolveIdentity });

  const drainTimer = setInterval(() => {
    void drainOutbox(db, fga).catch((err: unknown) => {
      logger.error({ err }, "Scheduled outbox drain failed");
    });
  }, options.drainIntervalMs);
  // Do not hold the event loop open just for the timer.
  drainTimer.unref();

  const shutdown = async (): Promise<void> => {
    clearInterval(drainTimer);
    await app.close();
    await db.destroy();
  };
  process.on("SIGINT", () => void shutdown().then(() => process.exit(0)));
  process.on("SIGTERM", () => void shutdown().then(() => process.exit(0)));

  await app.listen({ port: options.port, host: "127.0.0.1" });
  logger.info({ port: options.port }, "Archive API listening");
};

const program = new Command()
  .name("waggle-api")
  .description("Serve the archive ledger: authorization-gated signed URLs")
  .addOption(
    new Option("--database-url <url>", "Postgres connection string")
      .env("DATABASE_URL")
      .makeOptionMandatory(true),
  )
  .addOption(
    new Option("--port <n>", "Port to listen on")
      .env("WAGGLE_API_PORT")
      .default(DEFAULT_PORT)
      .argParser(parsePort),
  )
  .addOption(
    new Option("--drain-interval-ms <ms>", "How often to deliver queued tuples to OpenFGA")
      .env("WAGGLE_DRAIN_INTERVAL_MS")
      .default(DEFAULT_DRAIN_INTERVAL_MS)
      .argParser((value: string) => Number.parseInt(value, 10)),
  )
  .showHelpAfterError(true);

program.parse(process.argv);
start(program.opts<ServerOptions>()).catch((error: unknown) => {
  logger.fatal({ err: error }, "Fatal error");
  process.exit(1);
});
