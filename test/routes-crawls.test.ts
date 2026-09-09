import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Fastify, { type FastifyError, type FastifyInstance } from "fastify";
import { registerCrawlRoutes, type CrawlRouteDeps } from "../src/api/crawls.js";

/**
 * クロールを起こす口の検査。
 *
 * `routes-runs.test.ts` と同じ 2 層。入口の検証は張りぼて deps で、認可と単一実行は
 * 偽の DB で見る。**認可そのものを見ているのではない** —— fga は「false を返せ」と
 * 言われて false を返しているだけで、`can_submit` が誰を拒むかは
 * `fga/model.fga.yaml` の assertion が見ている。
 */
const TOUCHED_DEPS = "deps を使った（検証を通過した証拠）";
const explode = (): never => {
  throw new Error(TOUCHED_DEPS);
};

const unreachableDeps = {
  db: new Proxy({}, { get: explode }),
  fga: new Proxy({}, { get: explode }),
  resolveIdentity: explode,
  dispatch: explode,
} as unknown as CrawlRouteDeps;

const SUBJECT = { "x-waggle-subject": "alice", "x-waggle-organizations": "acme" };
const UUID = "d272d256-e528-4581-bb4e-8d9477d78196";
const SEED = "https://example.com/start";

const buildApp = async (deps: CrawlRouteDeps): Promise<FastifyInstance> => {
  // server.ts と同じ ajv 設定 —— 知らない鍵を落とさずに拒む。
  const app = Fastify({ logger: false, ajv: { customOptions: { removeAdditional: false } } });
  app.setErrorHandler((error: FastifyError, _request, reply) => {
    if (error.statusCode !== undefined && error.statusCode < 500) return reply.send(error);
    return reply.code(500).send({ error: "internal error" });
  });
  registerCrawlRoutes(app, deps);
  await app.ready();
  return app;
};

describe("クロール route の入力検証", () => {
  let app: FastifyInstance;
  const original = process.env["WAGGLE_DEV_IDENTITY"];

  beforeEach(async () => {
    process.env["WAGGLE_DEV_IDENTITY"] = "1";
    app = await buildApp(unreachableDeps);
  });

  afterEach(async () => {
    await app.close();
    if (original === undefined) delete process.env["WAGGLE_DEV_IDENTITY"];
    else process.env["WAGGLE_DEV_IDENTITY"] = original;
  });

  const post = (payload: Record<string, unknown>) =>
    app.inject({ method: "POST", url: "/api/crawls", headers: SUBJECT, payload });

  it("requires a seed", async () => {
    expect((await post({})).statusCode).toBe(400);
  });

  it("rejects a body key that is not on the allowlist", async () => {
    expect((await post({ seed: SEED, signing: true })).statusCode).toBe(400);
  });

  it("rejects a scope it does not know", async () => {
    // 範囲は挙動を決めるので、綴りの誤りを通すと黙って別の範囲になる。
    expect((await post({ seed: SEED, scope: "same-site" })).statusCode).toBe(400);
  });

  it("rejects limits outside their range", async () => {
    expect((await post({ seed: SEED, maxPages: 0 })).statusCode).toBe(400);
    expect((await post({ seed: SEED, maxDepth: -1 })).statusCode).toBe(400);
    expect((await post({ seed: SEED, hostParallelism: 0 })).statusCode).toBe(400);
  });

  it("allows a zero delay so a test can take it away on purpose", async () => {
    // 0 を弾くと「間隔が効いている」の反証が書けなくなる。schema は通し、
    // 通った先で deps に触れて落ちる。
    expect((await post({ seed: SEED, perHostDelayMs: 0 })).statusCode).toBe(500);
  });

  it("rejects a crawl id that is not a uuid", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/crawls/not-a-uuid",
      headers: SUBJECT,
    });
    expect(res.statusCode).toBe(400);
  });
});

/** 認可と単一実行を見るための、最小の偽物。 */
interface FakeCrawl {
  id: string;
  seed: string;
  scope: string;
  state: string;
  maxDepth: number;
  maxPages: number;
  perHostDelayMs: number;
  hostParallelism: number;
  orgId: string;
  requestedBy: string;
  stopReason: string | null;
  startedAt: Date;
  finishedAt: Date | null;
  pagesDiscovered: number;
  pagesCaptured: number;
  error: string | null;
}

/**
 * 走行中を 1 本だけ許す偽の DB。本物は部分 unique index が守るので、ここでは同じ形の
 * 失敗（`23505` と制約名）を投げて、409 への翻訳だけを固定する。
 *
 * **index そのものはここでは証明できない** —— 制約を持っているのが偽物のほうだから。
 * 本物の Postgres に対して別途確かめること。
 */
const fakeDb = (crawls: FakeCrawl[]) => ({
  insertInto: (table: string) => ({
    values: (row: Record<string, unknown>) => ({
      execute: async (): Promise<void> => {
        if (table === "crawlPages") return Promise.resolve();
        if (crawls.some((c) => c.state === "running")) {
          const err = new Error("duplicate key") as Error & { code: string; constraint: string };
          err.code = "23505";
          err.constraint = "crawls_single_active_idx";
          throw err;
        }
        crawls.push({
          ...(row as unknown as FakeCrawl),
          stopReason: null,
          startedAt: new Date(),
          finishedAt: null,
          pagesDiscovered: 0,
          pagesCaptured: 0,
          error: null,
        });
        await Promise.resolve();
      },
    }),
  }),
  updateTable: () => ({
    set: () => ({ where: () => ({ execute: async (): Promise<void> => Promise.resolve() }) }),
  }),
  selectFrom: () => ({
    selectAll: () => ({
      where: (_c: unknown, _o: unknown, id: string) => ({
        executeTakeFirst: async (): Promise<FakeCrawl | undefined> =>
          Promise.resolve(crawls.find((c) => c.id === id)),
      }),
    }),
  }),
});

const depsWith = (opts: {
  crawls: FakeCrawl[];
  allowed: boolean;
  dispatch?: CrawlRouteDeps["dispatch"];
}): CrawlRouteDeps =>
  ({
    db: fakeDb(opts.crawls),
    fga: { check: async () => Promise.resolve({ allowed: opts.allowed }) },
    resolveIdentity: () => Promise.resolve({ subject: "alice", organizations: ["acme"] }),
    dispatch: opts.dispatch ?? (() => Promise.resolve()),
  }) as unknown as CrawlRouteDeps;

describe("クロール route の認可と単一実行", () => {
  it("refuses an unauthenticated caller", async () => {
    // 認可は通す側に倒してある。401 が fga より前で返っている証拠。
    const app = await buildApp({
      ...depsWith({ crawls: [], allowed: true }),
      resolveIdentity: () => Promise.resolve(undefined),
    });
    const res = await app.inject({ method: "POST", url: "/api/crawls", payload: { seed: SEED } });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it("hides the endpoint from a caller without permission", async () => {
    const app = await buildApp(depsWith({ crawls: [], allowed: false }));
    const res = await app.inject({ method: "POST", url: "/api/crawls", payload: { seed: SEED } });
    expect(res.statusCode).toBe(404);
    await app.close();
  });

  it("refuses a seed that is not an http url", async () => {
    // schema は「文字列であること」しか見ない。scheme はここで落とす。
    const app = await buildApp(depsWith({ crawls: [], allowed: true }));
    const res = await app.inject({
      method: "POST",
      url: "/api/crawls",
      payload: { seed: "ftp://example.com/x" },
    });
    expect(res.statusCode).toBe(400);
    await app.close();
  });

  it("accepts a crawl and answers 202 without waiting for it", async () => {
    const crawls: FakeCrawl[] = [];
    const app = await buildApp(depsWith({ crawls, allowed: true }));
    const res = await app.inject({ method: "POST", url: "/api/crawls", payload: { seed: SEED } });
    expect(res.statusCode).toBe(202);
    expect(res.json()).toHaveProperty("crawlId");
    expect(crawls[0]?.state).toBe("running");
    await app.close();
  });

  it("stores the defaults when the caller asks for nothing", async () => {
    // 既定は控えめな側。**30 が効いていること**が、上限で止まる普通の姿を作る。
    const crawls: FakeCrawl[] = [];
    const app = await buildApp(depsWith({ crawls, allowed: true }));
    await app.inject({ method: "POST", url: "/api/crawls", payload: { seed: SEED } });
    expect(crawls[0]).toMatchObject({
      scope: "same-origin",
      maxDepth: 2,
      maxPages: 30,
      perHostDelayMs: 2000,
      hostParallelism: 4,
    });
    await app.close();
  });

  it("normalizes the seed before storing it", async () => {
    const crawls: FakeCrawl[] = [];
    const app = await buildApp(depsWith({ crawls, allowed: true }));
    await app.inject({
      method: "POST",
      url: "/api/crawls",
      payload: { seed: "https://example.com/start#top" },
    });
    expect(crawls[0]?.seed).toBe("https://example.com/start");
    await app.close();
  });

  it("refuses a second crawl while one is in flight", async () => {
    const crawls: FakeCrawl[] = [];
    const app = await buildApp(depsWith({ crawls, allowed: true }));
    const first = await app.inject({ method: "POST", url: "/api/crawls", payload: { seed: SEED } });
    const second = await app.inject({
      method: "POST",
      url: "/api/crawls",
      payload: { seed: SEED },
    });
    expect(first.statusCode).toBe(202);
    expect(second.statusCode).toBe(409);
    expect(crawls).toHaveLength(1);
    await app.close();
  });

  it("answers 404 for a crawl that does not exist", async () => {
    const app = await buildApp(depsWith({ crawls: [], allowed: true }));
    const res = await app.inject({ method: "GET", url: `/api/crawls/${UUID}` });
    expect(res.statusCode).toBe(404);
    await app.close();
  });
});
