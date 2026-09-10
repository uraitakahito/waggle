/**
 * 段の報告を受けたとき、**manifest をどこに探しに行くか**。
 *
 * これは配線の試験で、`keyPrefixFor` の試験ではない。判断そのものは
 * `crawl-key-prefix.test.ts` が見ているが、**その判断がここまで届いているか**は
 * 別の話 —— 反証で、route 側を「いまの設定から導く」形に戻しても 226 本すべてが
 * 緑のまま通った。今回の変更の動機そのものが無防備だった。
 *
 * 見るのは `admitLevel` が受け取る `keyPrefix` の 1 点だけ。`admitLevel` の中身は
 * `admit-level.test.ts` の担当なので、ここでは偽物にして呼ばれ方だけを記録する。
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import type { CrawlRouteDeps } from "../src/api/crawls.js";

vi.mock("../src/crawl/admit-level.js", () => ({ admitLevel: vi.fn() }));

const { admitLevel } = await import("../src/crawl/admit-level.js");
const { registerCrawlRoutes } = await import("../src/api/crawls.js");
const { parseCaptureFormats } = await import("../src/config/capture-formats.js");

const CRAWL = "d272d256-e528-4581-bb4e-8d9477d78196";
const TASK = "550e8400-e29b-41d4-a716-446655440000";
const SUBJECT = { "x-waggle-subject": "alice", "x-waggle-organizations": "acme" };
const SINK = { origin: "https://waggle.example", secret: "s" };

/** 偽の `crawls` 行。試験ごとに `artifactKeyPrefix` を差し替える。 */
let crawlRow: Record<string, unknown>;

const fakeDb = {
  selectFrom: () => ({
    selectAll: () => ({
      where: () => ({ executeTakeFirst: () => Promise.resolve(crawlRow) }),
    }),
  }),
  updateTable: () => ({
    set: () => ({ where: () => ({ where: () => ({ execute: () => Promise.resolve() }) }) }),
  }),
  insertInto: () => ({
    values: () => ({
      onConflict: () => ({ execute: () => Promise.resolve() }),
      execute: () => Promise.resolve(),
    }),
  }),
};

const buildApp = async (sink: typeof SINK | undefined): Promise<FastifyInstance> => {
  const app = Fastify({ logger: false, ajv: { customOptions: { removeAdditional: false } } });
  registerCrawlRoutes(app, {
    db: fakeDb,
    fga: { check: () => Promise.resolve({ allowed: true }) },
    resolveIdentity: () => Promise.resolve({ subject: "alice", organizations: ["acme"] }),
    dispatch: () => Promise.resolve(),
    s3: {},
    bucket: "b",
    capture: parseCaptureFormats("wacz", false),
    ...(sink !== undefined && { sink }),
  } as unknown as CrawlRouteDeps);
  await app.ready();
  return app;
};

/**
 * 1 段ぶんの報告を投げ、`admitLevel` が受け取った options を返す。
 *
 * **応答の状態は見ない。** この偽 DB は `admitLevel` を呼ぶところまでしか写して
 * おらず、その先 (次の段の立案と dispatch) では落ちる。ここで見たいのは
 * 「どこを探しに行くか」の 1 点で、段の往復そのものは別の関心。
 *
 * 代わりに **呼ばれたこと自体を断定する** —— route が `admitLevel` を呼ばなく
 * なれば `mock.calls[0]` が無くなり、ここが赤くなる。
 */
const report = async (sink: typeof SINK | undefined): Promise<Record<string, unknown>> => {
  const app = await buildApp(sink);
  try {
    await app.inject({
      method: "POST",
      url: `/api/crawls/${CRAWL}/pages`,
      headers: SUBJECT,
      payload: {
        depth: 0,
        results: [{ url: "https://example.com/start", status: "captured", taskId: TASK }],
      },
    });
  } finally {
    await app.close();
  }
  const call = vi.mocked(admitLevel).mock.calls[0];
  expect(call).toBeDefined();
  return (call?.[1] ?? {}) as unknown as Record<string, unknown>;
};

beforeEach(() => {
  vi.mocked(admitLevel).mockReset();
  vi.mocked(admitLevel).mockResolvedValue({ registered: 0, admittedUrls: [] });
  crawlRow = {
    id: CRAWL,
    orgId: "acme",
    requestedBy: "alice",
    state: "running",
    maxPages: 10,
    maxDepth: 2,
    scope: "same-host",
    seeds: ["https://example.com/start"],
    perHostDelayMs: 0,
    hostParallelism: 1,
    pagesDiscovered: 1,
    pagesCaptured: 0,
    artifactKeyPrefix: null,
  };
});

describe("段の報告が manifest を探す場所", () => {
  /**
   * **月を「いま」と違う 2026-01 にしてある。** 同じ月のうちは記録から読んでも
   * `orgId` から組み直しても同じ綴りになるので、区別できる入力を置かないと
   * 検査が素通りする —— まさにそれで反証が緑のまま通った。
   */
  it("記録された接頭辞を admitLevel に渡す", async () => {
    crawlRow["artifactKeyPrefix"] = "org/acme/2026-01/";

    expect(await report(SINK)).toMatchObject({ keyPrefix: "org/acme/2026-01/" });
  });

  // 受け口を切った後で同じクロールの続きを報告しても、探し先は変わらない。
  // ここが設定を見ていると接頭辞が消え、manifest が見つからなくなる。
  it("受け口の設定が消えても、記録が在ればそこを探す", async () => {
    crawlRow["artifactKeyPrefix"] = "org/acme/2026-01/";

    expect(await report(undefined)).toMatchObject({ keyPrefix: "org/acme/2026-01/" });
  });

  // `013` より前に作られた行。従来どおり設定から導く。
  it("記録が無ければ従来どおり設定から導く", async () => {
    expect(await report(SINK)).toMatchObject({ keyPrefix: "org/acme/" });
  });

  // 受け口を使わない配備。接頭辞そのものを渡さない (平らな名前空間)。
  it("記録も受け口も無ければ接頭辞を渡さない", async () => {
    expect(await report(undefined)).not.toHaveProperty("keyPrefix");
  });
});
