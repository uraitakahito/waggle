#!/usr/bin/env node
/**
 * アーカイブの API。署名付き URL を配る唯一のもの。
 *
 * ついでにタイマーで outbox を掃き出す。別サービスにせずプロセス内で走らせても
 * 安全なのは、`drainOutbox` が `FOR UPDATE SKIP LOCKED` を取るから —— API の
 * インスタンスが複数あっても、手で叩く `waggle-ledger drain` が加わっても、
 * 互いを踏まない。
 */
import Fastify, { type FastifyError } from "fastify";
import { Command, Option } from "commander";
import { collectEnv, fgaFrom, storageFrom } from "../config/env.js";
import { createKyselyClient } from "../db/kysely.js";
import { createFgaClient } from "../fga/client.js";
import { drainOutbox } from "../fga/outbox-worker.js";
import { createS3Client } from "../archive/s3.js";
import { resolveIdentityResolver } from "./identity.js";
import { registerRoutes } from "./routes.js";
import { registerPicker, replayOriginFromEnv } from "./picker.js";
import { fatal, logger } from "../logger.js";

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
  // S3 と OpenFGA を **1 つの collectEnv の中で** 建てる。別々に呼ぶと 1 つ目が
  // 投げた時点で 2 つ目は評価されないので、S3 の 4 個を直したあとに FGA の 2 個が
  // 出てきて往復が 2 回になる。
  const { storage, fgaSettings } = collectEnv((need) => ({
    storage: storageFrom(need),
    fgaSettings: fgaFrom(need),
  }));
  const db = createKyselyClient(options.databaseUrl);
  const fga = createFgaClient(fgaSettings);
  const s3 = createS3Client(storage);
  const resolveIdentity = resolveIdentityResolver();

  if (process.env["WAGGLE_DEV_IDENTITY"] === "1") {
    logger.warn(
      "WAGGLE_DEV_IDENTITY=1 — callers are trusted on the X-Waggle-Subject header. Never enable this outside local development.",
    );
  }

  const app = Fastify({ logger: false });

  /**
   * 予期しない失敗の中身を client に出さない。
   *
   * Fastify の既定は 500 でも `err.message` と `err.code` をそのまま返す。
   * Postgres のエラーはそこに列の型と値の成れの果てを載せてくるので、
   * client 側の誤りが **サーバ内部の形を教える窓** になる。
   *
   * 4xx は素通しする —— あれは client に向けて書かれた文言で、隠す理由が無い。
   * 500 の詳細は logger に残るので、調査する側は何も失わない。
   */
  app.setErrorHandler((error: FastifyError, request, reply) => {
    if (error.statusCode !== undefined && error.statusCode < 500) {
      return reply.send(error);
    }
    logger.error({ err: error, url: request.url }, "Unhandled error");
    return reply.code(500).send({ error: "internal error" });
  });

  registerRoutes(app, { db, fga, s3, resolveIdentity });
  registerPicker(app, replayOriginFromEnv());

  const drainTimer = setInterval(() => {
    void drainOutbox(db, fga).catch((err: unknown) => {
      logger.error({ err }, "Scheduled outbox drain failed");
    });
  }, options.drainIntervalMs);
  // タイマーのためだけに event loop を開いたままにしない。
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
start(program.opts<ServerOptions>()).catch(fatal);
