/**
 * 受け口の口を、偽の deps に対して試す。
 *
 * 固めているのは **DB に届く前に落ちること**。実地の疎通確認で、UUID でない `crawlId` が
 * そのまま問い合わせに渡り、Postgres の `invalid input syntax for type uuid` で
 * **500 になった**。呼ぶ側から見れば「そんな crawl は無い」でしかないので 404 に畳む。
 *
 * 偽の DB は **呼ばれたら記録する**。「404 が返った」だけでは、DB を叩いた後で
 * 404 にしているのか、叩く前に落としているのかを区別できない。
 */
import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { issueSinkToken, registerSinkRoutes } from "../src/api/sink.js";

const SECRET = "s3cret";
const CRAWL = "456a75bf-7082-49a7-86ce-e2fb24e879da";

let app: FastifyInstance;
let selects: number;
/** 偽の `crawls` 行。試験ごとに書き換えて、置き場所の決まり方を分ける。 */
let crawlRow: { orgId: string; artifactKeyPrefix: string | null };

const bearer = (crawlId: string): string =>
  `Bearer ${issueSinkToken(SECRET, crawlId, new Date(Date.now() + 60_000))}`;

beforeEach(() => {
  selects = 0;
  // 既定は `013` より前に作られた行 —— 記録が無いので従来の綴りに落ちる。
  crawlRow = { orgId: "acme", artifactKeyPrefix: null };
  app = Fastify();
  const db = {
    selectFrom: () => {
      selects += 1;
      return {
        select: () => ({
          where: () => ({ executeTakeFirst: () => Promise.resolve(crawlRow) }),
        }),
      };
    },
  };
  const s3 = { send: () => Promise.resolve({}) };
  registerSinkRoutes(app, {
    db: db as never,
    s3: s3 as never,
    bucket: "b",
    secret: SECRET,
  });
});

afterEach(async () => {
  await app.close();
});

describe("受け口の口", () => {
  it("正しいトークンなら location を返す", async () => {
    const res = await app.inject({
      method: "PUT",
      url: `/api/sink/${CRAWL}/a.wacz`,
      headers: { authorization: bearer(CRAWL), "content-type": "application/wacz+zip" },
      payload: "bytes",
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ location: "s3://b/org/acme/a.wacz" });
  });

  /**
   * **クロールを作ったときに決めた場所へ置く。** ここで `orgId` から組み直すと、
   * 月をまたいだクロールや受け口の設定を切り替えた配備で、探す側とずれる。
   *
   * 月を **いまと違う 2026-01** にしてあるのが肝。同じ月のうちは記録から読んでも
   * 組み直しても同じ綴りになるので、区別できる入力を置かないと検査が素通りする。
   */
  it("記録された接頭辞の下に置く", async () => {
    crawlRow = { orgId: "acme", artifactKeyPrefix: "org/acme/2026-01/" };

    const res = await app.inject({
      method: "PUT",
      url: `/api/sink/${CRAWL}/a.wacz`,
      headers: { authorization: bearer(CRAWL), "content-type": "application/wacz+zip" },
      payload: "bytes",
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ location: "s3://b/org/acme/2026-01/a.wacz" });
  });

  it("UUID でない crawlId は DB に届く前に 404", async () => {
    const res = await app.inject({
      method: "PUT",
      url: "/api/sink/not-a-uuid/a.wacz",
      headers: { authorization: bearer("not-a-uuid") },
      payload: "bytes",
    });

    expect(res.statusCode).toBe(404);
    // **これが要。** DB を叩いてから 404 にしているなら 500 の道が残っている。
    expect(selects).toBe(0);
  });

  it("他のクロールのトークンは 401", async () => {
    const res = await app.inject({
      method: "PUT",
      url: `/api/sink/${CRAWL}/a.wacz`,
      headers: { authorization: bearer("11111111-1111-4111-8111-111111111111") },
      payload: "bytes",
    });

    expect(res.statusCode).toBe(401);
    expect(selects).toBe(0);
  });

  it("トークンが無ければ 401", async () => {
    const res = await app.inject({
      method: "PUT",
      url: `/api/sink/${CRAWL}/a.wacz`,
      payload: "bytes",
    });

    expect(res.statusCode).toBe(401);
  });

  it("空の本文は 400", async () => {
    const res = await app.inject({
      method: "PUT",
      url: `/api/sink/${CRAWL}/a.wacz`,
      headers: { authorization: bearer(CRAWL) },
      payload: "",
    });

    expect(res.statusCode).toBe(400);
  });
});
