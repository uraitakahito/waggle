/**
 * リンクを辿る取り込みを、外から起こすための口。
 *
 * 実行そのものは Windmill の flow が回し、BrowserHive を直接呼ぶ。ここに残るのは
 * **認可・方針・記録** の 3 つ —— つまり「誰が起こしてよいか」「どこまで辿るか」
 * 「何が起きたか」。走らせる段取りは持たない。
 *
 * ## なぜ判断がここに集まるのか
 *
 * 範囲の絞り込みも重複排除も上限の判定も、**flow ではなくこちら**で行う。方針は
 * `crawls` の行に在り、重複排除は `crawl_pages` の unique index が持っているので、
 * 判断材料が両方ここに在る。flow 側に写すと、2 つの場所が食い違ったときにどちらが
 * 正しいのか言えなくなる。
 *
 * flow がすることは「見つけたものを全部報告し、次に取るものを受け取る」だけ。
 *
 * ## 走行中は 1 本
 *
 * ホストあたりの間隔は flow のループの形が守っている。2 本のクロールが同時に走ると
 * 互いの間隔が見えず、同じホストへの頻度が黙って倍になる。だから `crawls` の部分
 * unique index で 1 本に縛り、違反を 409 に翻訳する (`007-create-crawls` に詳しい)。
 *
 * ## 帰属
 *
 * 投げるのが waggle でなくなっても、`capture_submissions` はここで書く。段ごとの
 * 報告に taskId が載っているので、そのときに書けばよい。reconciler が
 * `unattributed` を数えている理由 (`archive/reconcile.ts`) はそのまま残る。
 */
import type { FastifyInstance } from "fastify";
import type { OpenFgaClient } from "@openfga/sdk";
import type { Kysely } from "kysely";
import type { S3Client } from "@aws-sdk/client-s3";
import { randomUUID } from "node:crypto";
import type { Database, CrawlScope } from "../db/database.js";
import type { IdentityResolver } from "./identity.js";
import { admitLevel } from "../crawl/admit-level.js";
import { acceptLinks, parseHttpUrl, type DiscoveredLink } from "../crawl/scope.js";
import { planNextLevel } from "../crawl/budget.js";
import { getJsonObject } from "../archive/s3.js";
import { isUniqueViolation, maySubmit, unauthorized } from "./authorization.js";
import { createChildLogger } from "../logger.js";

const log = createChildLogger({ module: "api" });

/**
 * 既定の方針。**控えめな側に倒してある。**
 *
 * `MAX_PAGES` が小さいのは、深さより先にこちらで止まるのが普通であってほしいから ——
 * 上限が働いていることが日常的に見えていれば、「全部辿った」と思い込む余地が消える。
 * 広げるのは呼ぶ側の意図的な行為にする。
 *
 * `PER_HOST_DELAY_MS` は 1 回の取り込みが 1 リクエストではないことを踏まえた値。
 * ブラウザはサブリソースまで取るので、1 ページが相手には数十本のバーストに見える。
 */
const DEFAULT_SCOPE: CrawlScope = "same-origin";
const DEFAULT_MAX_DEPTH = 2;
const DEFAULT_MAX_PAGES = 30;
const DEFAULT_PER_HOST_DELAY_MS = 2000;
const DEFAULT_HOST_PARALLELISM = 4;

/** Windmill に投げる関数。既定は webhook を叩くもので、試験だけが差し替える。 */
export type CrawlDispatcher = (crawl: DispatchedCrawl) => Promise<void>;

/**
 * Windmill の flow に渡す 1 段ぶんの仕事。
 *
 * **段の繰り返しは waggle が回す。** flow は 1 段を処理して報告するだけで、次があるかを
 * 判断しない。そうしたのは、Windmill の while ループが止まらなかったから ——
 * `stop_after_if` を付けた最小の flow が 643 回まで回り続けた (実測)。相手のサーバに
 * 負荷をかけない仕組みを、暴走しうるループの上には載せられない。
 *
 * 上限の判定は `budget.ts` に在って単体試験がある。**繰り返しは、その判定と同じ場所に置く。**
 */
export interface DispatchedCrawl {
  crawlId: string;
  depth: number;
  /**
   * この段で取る URL。空で渡すことはない。
   *
   * `lastFinishedAt` は **そのホストを最後に触り終えた時刻**。段をまたぐ間隔を
   * 守るために要る —— 間隔は `crawl_host` の呼び出し 1 回の中でしか効かないので、
   * これが無いと段の境目だけ間隔が空かない。実測で 521ms まで詰まった。
   */
  frontier: { url: string; host: string; lastFinishedAt: string | null }[];
  perHostDelayMs: number;
  hostParallelism: number;
}

export interface CrawlRouteDeps {
  db: Kysely<Database>;
  fga: OpenFgaClient;
  /**
   * `.links.json` を読むため。**リンクを読むのは waggle の仕事にしてある** ——
   * Windmill に読ませると S3 の資格情報と到達性をあちらにも用意することになり、
   * (別ドメインのコンテナからは seaweedfs に届かないという実務上の壁もある)
   * 「見つけた URL は何か」の判断材料が 2 か所に散る。
   */
  s3: S3Client;
  bucket: string;
  resolveIdentity: IdentityResolver;
  dispatch: CrawlDispatcher;
}

interface CrawlBody {
  seed?: string;
  scope?: CrawlScope;
  maxDepth?: number;
  maxPages?: number;
  perHostDelayMs?: number;
  hostParallelism?: number;
}

/** 段の報告 1 件。flow が 1 ページ処理するたびに 1 つ積む。 */
interface PageReport {
  url: string;
  status: "captured" | "failed" | "skipped";
  skipReason?: string;
  taskId?: string;
  correlationId?: string;
  submittedAt?: string;
  finishedAt?: string;
  /** `.links.json` の置き場所 (`s3://bucket/key`)。中身を読むのはこちら。 */
  linksLocation?: string;
}

interface LevelBody {
  depth: number;
  results: PageReport[];
}

export const registerCrawlRoutes = (app: FastifyInstance, deps: CrawlRouteDeps): void => {
  const { db, fga, resolveIdentity, dispatch } = deps;

  /**
   * クロールを 1 本起こす。
   *
   * 完了は待たない —— 段を重ねるので、待てる呼び出し元が居ない。受理したことだけを
   * 202 で返し、続きは `crawls` の行が語る。
   */
  app.post<{ Body: CrawlBody | undefined }>(
    "/api/crawls",
    {
      schema: {
        body: {
          type: "object",
          // 知らない鍵は拒む。`server.ts` の `removeAdditional: false` がこれを
          // 「黙って削る」ではなく「400 で返す」意味にしている。
          additionalProperties: false,
          required: ["seed"],
          properties: {
            seed: { type: "string", minLength: 1 },
            scope: { type: "string", enum: ["same-origin", "same-host"] },
            maxDepth: { type: "integer", minimum: 0, maximum: 10 },
            maxPages: { type: "integer", minimum: 1, maximum: 10000 },
            // 0 を許すのは、試験で意図的に間隔を外せるようにするため。
            perHostDelayMs: { type: "integer", minimum: 0, maximum: 600000 },
            hostParallelism: { type: "integer", minimum: 1, maximum: 32 },
          },
        },
      },
    },
    async (request, reply) => {
      const identity = await resolveIdentity(request);
      if (!identity) return unauthorized(reply);

      if (!(await maySubmit(fga, identity))) {
        log.info({ subject: identity.subject }, "Denied");
        return reply.code(404).send({ error: "not found" });
      }

      const body = request.body ?? {};
      // schema が `seed` を必須にしているので、ここに来た時点で文字列である。
      const seed = parseHttpUrl(body.seed ?? "");
      if (seed === undefined) {
        return reply.code(400).send({ error: "seed must be an http(s) URL" });
      }

      const crawlId = randomUUID();
      const crawl = {
        id: crawlId,
        seed: seed.normalized,
        scope: body.scope ?? DEFAULT_SCOPE,
        maxDepth: body.maxDepth ?? DEFAULT_MAX_DEPTH,
        maxPages: body.maxPages ?? DEFAULT_MAX_PAGES,
        perHostDelayMs: body.perHostDelayMs ?? DEFAULT_PER_HOST_DELAY_MS,
        hostParallelism: body.hostParallelism ?? DEFAULT_HOST_PARALLELISM,
        // 組織は呼び出し元の 1 つ目。`maySubmit` はどれか 1 つで許されていれば通すので、
        // 帰属も同じ組織に寄せる。
        orgId: identity.organizations[0] ?? "",
        requestedBy: identity.subject,
        state: "running" as const,
      };

      try {
        await db.insertInto("crawls").values(crawl).execute();
      } catch (err) {
        if (isUniqueViolation(err, "crawls_single_active")) {
          log.info({ subject: identity.subject }, "Crawl already in progress");
          return reply.code(409).send({ error: "a crawl is already in progress" });
        }
        throw err;
      }

      // 種を最初の行として置く。深さ 0。ここから flow が読む。
      await db
        .insertInto("crawlPages")
        .values({
          crawlId,
          url: seed.normalized,
          depth: 0,
          host: seed.host,
          state: "pending",
        })
        .execute();

      // 待たない。この Promise の行き先は `crawls` の行であって、この応答ではない。
      void dispatch({
        crawlId,
        depth: 0,
        // 最初の段には「前」が無い。
        frontier: [{ url: seed.normalized, host: seed.host, lastFinishedAt: null }],
        perHostDelayMs: crawl.perHostDelayMs,
        hostParallelism: crawl.hostParallelism,
      }).catch(async (err: unknown) => {
        log.error({ err, crawlId }, "Could not dispatch the crawl");
        await db
          .updateTable("crawls")
          .set({
            state: "failed",
            stopReason: "failed",
            finishedAt: new Date().toISOString(),
            error: err instanceof Error ? err.message : String(err),
          })
          .where("id", "=", crawlId)
          .execute()
          .catch((updateErr: unknown) => {
            log.error({ err: updateErr, crawlId }, "Could not record the dispatch failure");
          });
      });

      log.info({ subject: identity.subject, crawlId }, "Crawl started");
      return reply.code(202).send({ crawlId });
    },
  );

  /** クロール 1 本の状態。 */
  app.get<{ Params: { id: string } }>(
    "/api/crawls/:id",
    {
      schema: {
        params: {
          type: "object",
          properties: { id: { type: "string", format: "uuid" } },
          required: ["id"],
        },
      },
    },
    async (request, reply) => {
      const identity = await resolveIdentity(request);
      if (!identity) return unauthorized(reply);
      if (!(await maySubmit(fga, identity))) {
        return reply.code(404).send({ error: "not found" });
      }

      const crawl = await db
        .selectFrom("crawls")
        .selectAll()
        .where("id", "=", request.params.id)
        .executeTakeFirst();
      if (!crawl) return reply.code(404).send({ error: "not found" });

      return reply.code(200).send({
        crawlId: crawl.id,
        seed: crawl.seed,
        scope: crawl.scope,
        state: crawl.state,
        stopReason: crawl.stopReason,
        maxDepth: crawl.maxDepth,
        maxPages: crawl.maxPages,
        perHostDelayMs: crawl.perHostDelayMs,
        hostParallelism: crawl.hostParallelism,
        startedAt: crawl.startedAt,
        finishedAt: crawl.finishedAt,
        pagesDiscovered: crawl.pagesDiscovered,
        pagesCaptured: crawl.pagesCaptured,
        error: crawl.error,
      });
    },
  );

  /**
   * 1 段ぶんの報告を受け、次の段を返す。
   *
   * **この 1 往復に判断が全部入っている。** 報告を記録し、帰属を書き、見つけたリンクを
   * 範囲で絞り、重複を index に落とさせ、上限を当て、残ったものを返す。
   *
   * 重複排除を `ON CONFLICT DO NOTHING` + `returning` で行うのが肝 ——
   * 「入った行」がそのまま「次に取るもの」になるので、記録と決定がずれようがない。
   */
  app.post<{ Params: { id: string }; Body: LevelBody }>(
    "/api/crawls/:id/pages",
    {
      schema: {
        params: {
          type: "object",
          properties: { id: { type: "string", format: "uuid" } },
          required: ["id"],
        },
        body: {
          type: "object",
          additionalProperties: false,
          required: ["depth", "results"],
          properties: {
            depth: { type: "integer", minimum: 0 },
            results: {
              type: "array",
              items: {
                type: "object",
                additionalProperties: false,
                required: ["url", "status"],
                properties: {
                  url: { type: "string", minLength: 1 },
                  status: { type: "string", enum: ["captured", "failed", "skipped"] },
                  skipReason: { type: "string" },
                  taskId: { type: "string" },
                  correlationId: { type: "string" },
                  submittedAt: { type: "string", format: "date-time" },
                  finishedAt: { type: "string", format: "date-time" },
                  linksLocation: { type: "string" },
                },
              },
            },
          },
        },
      },
    },
    async (request, reply) => {
      const identity = await resolveIdentity(request);
      if (!identity) return unauthorized(reply);
      if (!(await maySubmit(fga, identity))) {
        return reply.code(404).send({ error: "not found" });
      }

      const crawlId = request.params.id;
      const crawl = await db
        .selectFrom("crawls")
        .selectAll()
        .where("id", "=", crawlId)
        .executeTakeFirst();
      if (!crawl) return reply.code(404).send({ error: "not found" });

      const { depth, results } = request.body;
      const seed = parseHttpUrl(crawl.seed);
      if (seed === undefined) {
        // 種は投入時に検査しているので、ここに来るのは行が壊れているとき。
        return reply.code(500).send({ error: "the crawl seed is not a usable url" });
      }

      // ── 1. 報告された行を閉じる ────────────────────────────────────────
      for (const page of results) {
        await db
          .updateTable("crawlPages")
          .set({
            state: page.status,
            skipReason: page.skipReason ?? null,
            taskId: page.taskId ?? null,
            correlationId: page.correlationId ?? null,
            submittedAt: page.submittedAt ?? null,
            finishedAt: page.finishedAt ?? null,
          })
          .where("crawlId", "=", crawlId)
          .where("url", "=", page.url)
          .execute();
      }

      // ── 2. 帰属を書く ────────────────────────────────────────────────
      // 投げたのが waggle でなくても、記録はここに残す。reconciler が
      // `unattributed` を数える経路を壊さないため。
      const captured = results.filter(
        (r): r is PageReport & { taskId: string } =>
          r.status === "captured" && typeof r.taskId === "string" && r.taskId !== "",
      );
      if (captured.length > 0) {
        await db
          .insertInto("captureSubmissions")
          .values(
            captured.map((r) => ({
              taskId: r.taskId,
              correlationId: r.correlationId ?? crawlId,
              orgId: crawl.orgId,
              submittedBy: crawl.requestedBy,
              sourceUrl: r.url,
            })),
          )
          .onConflict((oc) => oc.column("taskId").doNothing())
          .execute();

        // ── 2b. 台帳に載せる ──────────────────────────────────────────
        // ここが無いと、クロールしたページは `reconcile` を走らせるまで存在しない。
        // 詳しくは `crawl/admit-level.ts`。
        await admitLevel(captured, {
          db,
          s3: deps.s3,
          bucket: deps.bucket,
          crawlId,
          orgId: crawl.orgId,
          requestedBy: crawl.requestedBy,
        });
      }

      // ── 3. 見つけたリンクを読み、絞る ────────────────────────────────
      const links: DiscoveredLink[] = [];
      for (const page of results) {
        if (page.linksLocation === undefined || page.linksLocation === "") continue;
        // `s3://bucket/key` から鍵だけを取り出す。bucket はこちらの設定を使う ——
        // 報告に入っていた bucket を信じると、報告する側が読み先を選べることになる。
        const key = page.linksLocation.replace(/^s3:\/\/[^/]+\//, "");
        const raw = await getJsonObject(deps.s3, deps.bucket, key);
        if (raw === null || typeof raw !== "object") continue;
        const parsed = (raw as { links?: unknown }).links;
        if (!Array.isArray(parsed)) continue;
        for (const item of parsed) {
          if (
            typeof item === "object" &&
            item !== null &&
            typeof (item as DiscoveredLink).href === "string"
          ) {
            links.push(item as DiscoveredLink);
          }
        }
      }

      const discovered = acceptLinks(links, seed, crawl.scope);

      // ── 4. 上限を当てる ──────────────────────────────────────────────
      const nextDepth = depth + 1;
      const { count } = await db
        .selectFrom("crawlPages")
        .select((eb) => eb.fn.countAll<string>().as("count"))
        .where("crawlId", "=", crawlId)
        .executeTakeFirstOrThrow();

      const { toInsert, stopReason } = planNextLevel(discovered, {
        nextDepth,
        maxDepth: crawl.maxDepth,
        maxPages: crawl.maxPages,
        known: Number(count),
      });

      // ── 5. 重複を index に落とさせ、入った行だけを次の段にする ──────────
      const inserted =
        toInsert.length === 0
          ? []
          : await db
              .insertInto("crawlPages")
              .values(
                toInsert.map((link) => ({
                  crawlId,
                  url: link.url,
                  depth: nextDepth,
                  host: link.host,
                  state: "pending" as const,
                })),
              )
              .onConflict((oc) => oc.columns(["crawlId", "urlHash"]).doNothing())
              .returning(["url", "host"])
              .execute();

      // ── 6. 集計と、終わったなら締める ────────────────────────────────
      const capturedCount = results.filter((r) => r.status === "captured").length;
      const done = inserted.length === 0;

      // **最初に効いた理由を残す。上書きしない。**
      //
      // 段の途中で `max_pages` に当たって切っても、そのあと最後の段が `max_depth` で
      // 終われば、素朴に書くと後者で上書きされる。すると「深さの範囲は全部辿った」と
      // 読めてしまうが、実際には切り落としている —— 実測で踏んだ: 50 件見つけて 9 件
      // 入れたクロールが `max_depth` と記録された。
      //
      // `coalesce` で最初の非 NULL を守る。`budget.ts` が深さを件数より優先するのと
      // 同じ考え方で、**先に効いた制約**が理由になる。
      const reason = stopReason ?? (done ? ("completed" as const) : null);
      await db
        .updateTable("crawls")
        .set((eb) => ({
          pagesCaptured: eb("pagesCaptured", "+", capturedCount),
          pagesDiscovered: eb("pagesDiscovered", "+", discovered.length),
          ...(reason === null ? {} : { stopReason: eb.fn.coalesce("stopReason", eb.val(reason)) }),
          ...(done ? { state: "succeeded" as const, finishedAt: new Date().toISOString() } : {}),
        }))
        .where("id", "=", crawlId)
        .execute();

      log.info(
        { crawlId, depth, reported: results.length, next: inserted.length, stopReason },
        "Crawl level recorded",
      );

      // ── 7. 次の段があるなら、こちらから投げる ────────────────────────
      // flow は 1 段を処理して報告するだけ。繰り返しをここに置いたのは、上限の判定
      // (`budget.ts`) と同じ場所に置くため —— そして Windmill の while ループが
      // 止まらなかったため (`DispatchedCrawl` の注記を見ること)。
      if (!done) {
        // ホストごとの「最後に触り終えた時刻」を引く。段をまたぐ間隔のために要る。
        const lastByHost = new Map<string, string>();
        const seen = await db
          .selectFrom("crawlPages")
          .select((eb) => ["host", eb.fn.max("finishedAt").as("last")])
          .where("crawlId", "=", crawlId)
          .where("finishedAt", "is not", null)
          .groupBy("host")
          .execute();
        for (const row of seen) {
          if (row.last !== null) lastByHost.set(row.host, new Date(row.last).toISOString());
        }

        void dispatch({
          crawlId,
          depth: nextDepth,
          frontier: inserted.map((row) => ({
            url: row.url,
            host: row.host,
            lastFinishedAt: lastByHost.get(row.host) ?? null,
          })),
          perHostDelayMs: crawl.perHostDelayMs,
          hostParallelism: crawl.hostParallelism,
        }).catch(async (err: unknown) => {
          log.error({ err, crawlId, depth: nextDepth }, "Could not dispatch the next level");
          await db
            .updateTable("crawls")
            .set({
              state: "failed",
              stopReason: "failed",
              finishedAt: new Date().toISOString(),
              error: err instanceof Error ? err.message : String(err),
            })
            .where("id", "=", crawlId)
            .execute()
            .catch(() => undefined);
        });
      }

      return reply.code(200).send({
        next: inserted.map((row) => ({ url: row.url, host: row.host, depth: nextDepth })),
        stopReason: done ? (stopReason ?? "completed") : null,
      });
    },
  );
};
