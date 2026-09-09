import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Fastify, { type FastifyError, type FastifyInstance } from "fastify";
import { parseRunFormats, registerRunRoutes, type RunRouteDeps } from "../src/api/runs.js";
import type { SubmitResult } from "../src/client/submit.js";

/**
 * 実行を起こす口の検査。
 *
 * 2 つの層を別々に見る。**入口の検証**（`routes-validation.test.ts` と同じ張りぼて deps
 * で、ajv と 401 が handler より前に効くこと）と、**走行中は 1 本**（こちらは偽の DB が
 * 要る —— 本物の制約は Postgres の部分 unique index なので、ここでは「違反が 409 に
 * 翻訳されるか」だけを見る）。
 *
 * 後者が肝で、本物の実行は分単位で終わらないため、**決して解決しない launcher** でしか
 * 「走行中」を作れない。速い launcher だと 1 本目が終わってしまい、競合が起きずに
 * 緑で通ってしまう。
 */
const TOUCHED_DEPS = "deps を使った（検証を通過した証拠）";
const explode = (): never => {
  throw new Error(TOUCHED_DEPS);
};

const unreachableDeps = {
  db: new Proxy({}, { get: explode }),
  fga: new Proxy({}, { get: explode }),
  resolveIdentity: explode,
  launch: explode,
  baseOptions: { databaseUrl: "postgres://unused" },
} as unknown as RunRouteDeps;

const SUBJECT = { "x-waggle-subject": "alice", "x-waggle-organizations": "acme" };
const UUID = "d272d256-e528-4581-bb4e-8d9477d78196";

const buildApp = async (deps: RunRouteDeps): Promise<FastifyInstance> => {
  // server.ts と同じ ajv 設定 —— 知らない鍵を落とさずに拒む。
  const app = Fastify({ logger: false, ajv: { customOptions: { removeAdditional: false } } });
  app.setErrorHandler((error: FastifyError, _request, reply) => {
    if (error.statusCode !== undefined && error.statusCode < 500) return reply.send(error);
    return reply.code(500).send({ error: "internal error" });
  });
  registerRunRoutes(app, deps);
  await app.ready();
  return app;
};

describe("実行 route の入力検証", () => {
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

  it("rejects a body key that is not on the allowlist", async () => {
    // 渡せる設定を絞ってあるのは、CLI 側にしか無い検査 (--signing は --wacz を要る等) が
    // HTTP 経路では走らないため。知らない鍵は通さない。
    const res = await app.inject({
      method: "POST",
      url: "/api/runs",
      headers: SUBJECT,
      payload: { signing: true },
    });

    expect(res.statusCode).toBe(400);
  });

  it("rejects a limit that is not a positive integer", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/runs",
      headers: SUBJECT,
      payload: { limit: 0 },
    });

    expect(res.statusCode).toBe(400);
  });

  it("rejects a run id that is not a uuid", async () => {
    const res = await app.inject({ method: "GET", url: "/api/runs/not-a-uuid", headers: SUBJECT });

    expect(res.statusCode).toBe(400);
  });

  it("leaves a well-formed request to the handler", async () => {
    // 検証を通ったので deps に触れて落ちる。それが「通った」ということ。
    const res = await app.inject({
      method: "POST",
      url: "/api/runs",
      headers: SUBJECT,
      payload: { limit: 5 },
    });

    expect(res.statusCode).toBe(500);
  });
});

/** 認可まで届く経路を見るための、最小の偽物。 */
interface FakeRun {
  id: string;
  status: string;
  trigger: string;
  startedAt: Date;
  finishedAt: Date | null;
  submitted: number | null;
  accepted: number | null;
  rejected: number | null;
  error: string | null;
}

/**
 * 走行中を 1 行だけ許す偽の DB。本物は Postgres の部分 unique index が守るので、
 * ここでは同じ形の失敗（`23505` と制約名）を投げて、409 への翻訳だけを固定する。
 */
const fakeDb = (rows: FakeRun[]) => ({
  insertInto: () => ({
    values: (row: { id: string; status: string; trigger: string }) => ({
      execute: async (): Promise<void> => {
        if (rows.some((r) => r.status === "running")) {
          const err = new Error("duplicate key") as Error & { code: string; constraint: string };
          err.code = "23505";
          err.constraint = "runs_single_active_idx";
          throw err;
        }
        rows.push({
          id: row.id,
          status: row.status,
          trigger: row.trigger,
          startedAt: new Date(),
          finishedAt: null,
          submitted: null,
          accepted: null,
          rejected: null,
          error: null,
        });
        await Promise.resolve();
      },
    }),
  }),
  updateTable: () => ({
    set: (patch: Record<string, unknown>) => ({
      where: (_c: unknown, _o: unknown, id: string) => ({
        execute: async (): Promise<void> => {
          const row = rows.find((r) => r.id === id);
          if (row) Object.assign(row, patch);
          await Promise.resolve();
        },
      }),
    }),
  }),
  selectFrom: () => ({
    selectAll: () => ({
      where: (_c: unknown, _o: unknown, id: string) => ({
        executeTakeFirst: async (): Promise<FakeRun | undefined> =>
          Promise.resolve(rows.find((r) => r.id === id)),
      }),
    }),
  }),
});

const fakeFga = (allowed: boolean) => ({
  check: async (): Promise<{ allowed: boolean }> => Promise.resolve({ allowed }),
});

const depsWith = (opts: {
  rows: FakeRun[];
  allowed: boolean;
  launch: RunRouteDeps["launch"];
}): RunRouteDeps =>
  ({
    db: fakeDb(opts.rows),
    fga: fakeFga(opts.allowed),
    resolveIdentity: () => Promise.resolve({ subject: "alice", organizations: ["acme"] }),
    launch: opts.launch,
    baseOptions: { databaseUrl: "postgres://unused" },
  }) as unknown as RunRouteDeps;

/** 決して解決しない。「走行中」を作れる唯一の形。 */
const NEVER: Promise<SubmitResult[]> = new Promise<SubmitResult[]>(() => {
  /* 一向に解決しない */
});

describe("実行 route の認可と単一実行", () => {
  it("refuses an unauthenticated caller", async () => {
    // 認可のほうは通す側に倒してある。401 が **fga より前** で返っていることの証拠。
    const app = await buildApp({
      ...depsWith({ rows: [], allowed: true, launch: () => NEVER }),
      resolveIdentity: () => Promise.resolve(undefined),
    });

    const res = await app.inject({ method: "POST", url: "/api/runs", payload: {} });

    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it("hides the endpoint from a caller without permission", async () => {
    // 403 ではなく 404 —— 「してはいけない」と「無い」を区別させない。
    //
    // **これは経路の試験であって、認可そのものの試験ではない。** ここの fga は
    // 「false を返せ」と言われて false を返しているだけ。`can_submit` が本当に
    // 誰を拒むかは `fga/model.fga.yaml` の assertion が見ている —— とくに
    // 「所属しているだけでは起こせない」の 1 本。
    const app = await buildApp(depsWith({ rows: [], allowed: false, launch: () => NEVER }));

    const res = await app.inject({ method: "POST", url: "/api/runs", payload: {} });

    expect(res.statusCode).toBe(404);
    await app.close();
  });

  it("accepts a run and answers 202 without waiting for it", async () => {
    const rows: FakeRun[] = [];
    const app = await buildApp(depsWith({ rows, allowed: true, launch: () => NEVER }));

    const res = await app.inject({ method: "POST", url: "/api/runs", payload: {} });

    // 走り続けているのに応答は返っている。これが 202 の意味。
    expect(res.statusCode).toBe(202);
    expect(res.json()).toHaveProperty("runId");
    expect(rows).toHaveLength(1);
    expect(rows[0]?.status).toBe("running");
    await app.close();
  });

  it("refuses a second run while one is in flight", async () => {
    // 1 本目は決して終わらない。速い launcher だと競合が起きず、この試験は緑で通ってしまう。
    const rows: FakeRun[] = [];
    const app = await buildApp(depsWith({ rows, allowed: true, launch: () => NEVER }));

    const first = await app.inject({ method: "POST", url: "/api/runs", payload: {} });
    const second = await app.inject({ method: "POST", url: "/api/runs", payload: {} });

    expect(first.statusCode).toBe(202);
    expect(second.statusCode).toBe(409);
    expect(rows).toHaveLength(1);
    await app.close();
  });

  it("records the counts when the run finishes", async () => {
    const rows: FakeRun[] = [];
    const results: SubmitResult[] = [
      {
        taskId: "t1",
        correlationId: "c1",
        labels: [],
        orgId: "acme",
        sourceUrl: "u1",
        accepted: true,
      },
      {
        taskId: "t2",
        correlationId: "c2",
        labels: [],
        orgId: "acme",
        sourceUrl: "u2",
        accepted: false,
      },
    ];
    const app = await buildApp(
      depsWith({ rows, allowed: true, launch: () => Promise.resolve(results) }),
    );

    const res = await app.inject({ method: "POST", url: "/api/runs", payload: {} });
    expect(res.statusCode).toBe(202);

    // 背後の更新が回るまで待つ。
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(rows[0]?.status).toBe("succeeded");
    expect(rows[0]?.submitted).toBe(2);
    expect(rows[0]?.accepted).toBe(1);
    expect(rows[0]?.rejected).toBe(1);
    await app.close();
  });

  it("records the failure when the run throws", async () => {
    const rows: FakeRun[] = [];
    const app = await buildApp(
      depsWith({
        rows,
        allowed: true,
        launch: () => Promise.reject(new Error("browserhive unreachable")),
      }),
    );

    await app.inject({ method: "POST", url: "/api/runs", payload: {} });
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(rows[0]?.status).toBe("failed");
    expect(rows[0]?.error).toContain("browserhive unreachable");
    await app.close();
  });

  it("reports the state of a run", async () => {
    const rows: FakeRun[] = [
      {
        id: UUID,
        status: "succeeded",
        trigger: "api",
        startedAt: new Date("2026-09-09T00:00:00Z"),
        finishedAt: new Date("2026-09-09T00:05:00Z"),
        submitted: 3,
        accepted: 3,
        rejected: 0,
        error: null,
      },
    ];
    const app = await buildApp(depsWith({ rows, allowed: true, launch: () => NEVER }));

    const res = await app.inject({ method: "GET", url: `/api/runs/${UUID}` });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ runId: UUID, status: "succeeded", submitted: 3 });
    await app.close();
  });

  it("answers 404 for a run that does not exist", async () => {
    const app = await buildApp(depsWith({ rows: [], allowed: true, launch: () => NEVER }));

    const res = await app.inject({ method: "GET", url: `/api/runs/${UUID}` });

    expect(res.statusCode).toBe(404);
    await app.close();
  });
});

describe("実行の形式設定", () => {
  it("turns a comma separated list into capture flags", () => {
    expect(parseRunFormats("wacz,png", false)).toEqual({ wacz: true, png: true });
  });

  it("tolerates spacing and case", () => {
    expect(parseRunFormats(" WACZ , Html ", false)).toEqual({ wacz: true, html: true });
  });

  it("names the misspelling instead of silently dropping it", () => {
    // 黙って落とすと、綴りを間違えた形式は「取れていない」としてしか現れない ——
    // しかも server が返すのは「形式が 1 つも無い」で、env の値には触れない。
    expect(() => parseRunFormats("waxz", false)).toThrow(/waxz/);
  });

  it("refuses an empty setting", () => {
    expect(() => parseRunFormats("", false)).toThrow(/empty/);
  });

  it("refuses signing without wacz", () => {
    // CLI では parseClientOptions が同じことを言う。HTTP 経路はそこを通らない。
    expect(() => parseRunFormats("png", true)).toThrow(/wacz/);
  });

  it("adds signing when wacz is present", () => {
    expect(parseRunFormats("wacz", true)).toEqual({ wacz: true, signing: true });
  });
});
