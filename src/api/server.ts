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
import { collectEnv, fgaFrom, storageFrom, searchConfig } from "../config/env.js";
import { createKyselyClient } from "../db/kysely.js";
import { createFgaClient } from "../fga/client.js";
import { drainOutbox } from "../fga/outbox-worker.js";
import { createS3Client } from "../archive/s3.js";
import { resolveIdentityResolver } from "./identity.js";
import { registerRoutes } from "./routes.js";
import { registerPicker, replayOriginFromEnv } from "./picker.js";
import { registerRunRoutes } from "./runs.js";
import { parseCaptureFormats } from "../config/capture-formats.js";
import { registerCrawlRoutes } from "./crawls.js";
import { registerSearchRoutes } from "./search.js";
import { createSearchClient } from "../search/client.js";
import { createWindmillDispatcher } from "../crawl/dispatch.js";
import { runClient } from "../client/run.js";
import { optional } from "../config/env.js";
import { fatal, logger } from "../logger.js";

const DEFAULT_PORT = 7070;
const DEFAULT_DRAIN_INTERVAL_MS = 5_000;
/**
 * 待ち受けるアドレス。既定はループバックのまま —— 外に出すのは配備の判断で、
 * このプロセスは実行を起こせる口を持つ(`api/runs.ts`)。既定で広げない。
 */
const DEFAULT_HOST = "127.0.0.1";

/**
 * API から起こした実行が既定で取る形式。CLI に既定は無い (旗を書かなければ何も
 * 取らない) ので、ここが唯一の既定。`wacz` なのは、このパイプラインが作るのが
 * 再生できるアーカイブだから。
 */
const DEFAULT_CAPTURE_FORMATS = "wacz";

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

  const app = Fastify({
    logger: false,
    // 知らない鍵は **落とさずに拒む**。fastify の ajv は既定で `removeAdditional`
    // が立っており、`additionalProperties: false` は「黙って削る」意味になる ——
    // すると `POST /api/runs` に効かない設定を渡した呼び出し元が、渡ったつもりの
    // まま 202 を受け取る。頼んだことが無視されたなら、そう言うべき。
    ajv: { customOptions: { removeAdditional: false } },
  });

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
  // 実行を起こす口。取り込みの身元は今までどおり環境から来るので、ここでは渡さない
  // (`api/runs.ts` の冒頭を見ること)。渡すのは「どこの DB を読むか」だけ。
  // **形式は起動時に 1 回だけ解釈する。** run の口とクロールの口で同じ設定を使うので、
  // 2 度読むと片方だけ古い env を掴む余地ができる。
  const capture = parseCaptureFormats(
    optional("WAGGLE_CAPTURE_FORMATS", DEFAULT_CAPTURE_FORMATS),
    optional("WAGGLE_CAPTURE_SIGNING", "") === "1",
  );

  registerRunRoutes(app, {
    db,
    fga,
    resolveIdentity,
    launch: runClient,
    // **起動時に解釈する。** 綴りの誤りをここで落とすため (`parseCaptureFormats` を見ること)。
    baseOptions: {
      databaseUrl: options.databaseUrl,
      ...capture.formats,
      ...(capture.signing ? { signing: true } : {}),
    },
  });

  // リンクを辿るクロールの口。実行は Windmill の flow が回すので、ここが渡すのは
  // 「頼んだ」という事実だけ。dispatcher は **起動時に** 設定を読む —— 頼まれた瞬間に
  // 「設定がありません」と言うのでは遅く、そのときには行が既に立っている。
  //
  // 設定が無ければ口ごと出さない。**404 になるのは正しい** —— その配備にこの能力は
  // 本当に無いので、「してはいけない」と同じ答えでよい。log で区別が付くようにする。
  const dispatch = createWindmillDispatcher();
  if (dispatch === undefined) {
    logger.info("WAGGLE_CRAWL_WEBHOOK_URL is not set — /api/crawls is not served");
  } else {
    registerCrawlRoutes(app, {
      db,
      fga,
      s3,
      bucket: storage.bucket,
      resolveIdentity,
      dispatch,
      capture,
    });
  }

  // 全文検索の口。クロールと同じ形 —— 設定が無ければ出さない。索引を持たない配備が
  // ありうるし、そこでは 404 が正しい答え。
  const searchSettings = searchConfig();
  if (searchSettings === undefined) {
    logger.info("WAGGLE_OPENSEARCH_URL is not set — /api/search is not served");
  } else {
    registerSearchRoutes(app, {
      db,
      fga,
      s3,
      search: createSearchClient(searchSettings),
      index: searchSettings.index,
      resolveIdentity,
    });
  }

  const drainTimer = setInterval(() => {
    void drainOutbox(db, fga).catch((err: unknown) => {
      logger.error({ err }, "Scheduled outbox drain failed");
    });
  }, options.drainIntervalMs);
  // タイマーのためだけに event loop を開いたままにしない。
  drainTimer.unref();

  /**
   * **走行中の実行は待たない。** `app.close()` が待つのは応答を返していない
   * リクエストだけで、実行は 202 を返した後に続いているので、その勘定に入らない。
   * 途中で落ちた実行の `runs` の行は `running` のまま残り、次を塞ぐ —— 生きている
   * ものと区別する術が行に無い。片付けは運用の仕事 (`api/runs.ts` の GET を見ること)。
   */
  const shutdown = async (): Promise<void> => {
    clearInterval(drainTimer);
    await app.close();
    await db.destroy();
  };
  process.on("SIGINT", () => void shutdown().then(() => process.exit(0)));
  process.on("SIGTERM", () => void shutdown().then(() => process.exit(0)));

  const host = optional("WAGGLE_API_HOST", DEFAULT_HOST);
  await app.listen({ port: options.port, host });
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
