/**
 * 取り込みの実行を、外から起こすための口。
 *
 * これが在るのは、走らせる時刻を決める仕事を外のスケジューラに渡すため。境界を HTTP に
 * したのは、代わりの案 —— コンテナを直接起動する / スケジューラに DB を触らせる —— が
 * どちらも waggle の内側に手を伸ばすから。API なら「何を・どう投げるか」は waggle に残る。
 *
 * ## 起動した者と、実行の身元は別
 *
 * 認証するのは呼び出し元だが、取り込み自体は今までどおり **waggle 自身の身元**で走る
 * (`runClient` は環境の token から identity を組む)。CLI で起こしても API で起こしても
 * 台帳の `submittedBy` が同じになるので、記録が経路によってぶれない。起動した経路のほうは
 * `runs.trigger` が覚える。
 *
 * ## 誰が起こしてよいか
 *
 * 組織に対する `can_submit`。判断材料は **保存された tuple だけ** で、呼び出し元が
 * 名乗った所属は渡さない —— 渡すと検査が常に通る。`maySubmit` と `fga/model.fga` の
 * `submitter` の注記に、なぜそうなるかを書いてある。
 *
 * ## 走行中は 1 本
 *
 * gRPC の channel がプロセスに 1 つしかないので、2 本並べると壊れる
 * (`006-create-runs` に詳しい)。ここでは insert を試み、**部分 unique index の違反を
 * 409 に翻訳する**だけにしてある —— アプリ側のフラグで守ると、プロセスが増えた日に黙って破れる。
 */
import type { FastifyInstance, FastifyReply } from "fastify";
import type { OpenFgaClient } from "@openfga/sdk";
import { ConsistencyPreference } from "@openfga/sdk";
import type { Kysely } from "kysely";
import { randomUUID } from "node:crypto";
import type { Database } from "../db/database.js";
import type { Identity, IdentityResolver } from "./identity.js";
import type { ClientOptions } from "../config/cli-options.js";
import type { SubmitResult } from "../client/submit.js";
import { createChildLogger } from "../logger.js";

const log = createChildLogger({ module: "api" });

/**
 * この配備が取り込む形式。**env から決める。**
 *
 * 呼び出し元 (body) からは受けない。境界の取り決めが「外は *いつ* を決め、waggle が
 * *何を どう* 投げるかを決める」であり、形式は後者だから。加えて CLI 側の検査
 * (`--signing` は `--wacz` を要る) は `parseClientOptions` の中に住んでいて HTTP
 * 経路では走らないので、body から受けるならその検査を切り出す必要がある。
 *
 * 既定は `wacz` —— このパイプラインが作るのは再生できるアーカイブで、他の形式は
 * その付随物。1 つも選ばれていない設定は server が `INVALID_ARGUMENT` で弾くので、
 * 「形式なし」は既定になり得ない。
 */
const KNOWN_FORMATS = ["png", "webp", "html", "links", "mhtml", "wacz"] as const;
type RunFormat = (typeof KNOWN_FORMATS)[number];

const isKnownFormat = (value: string): value is RunFormat =>
  (KNOWN_FORMATS as readonly string[]).includes(value);

/**
 * `WAGGLE_API_RUN_FORMATS` を読む。**起動時に呼ぶこと。**
 *
 * 綴りの誤りをここで落とすためにある。実行のたびに解釈すると、`waxz` のような
 * 打ち間違いは夜中の定期実行が失敗して初めて見つかる —— しかも server が返すのは
 * 「形式が 1 つも無い」で、env の値には一言も触れない。
 */
export const parseRunFormats = (raw: string, signing: boolean): Partial<ClientOptions> => {
  const names = raw
    .split(",")
    .map((name) => name.trim().toLowerCase())
    .filter((name) => name !== "");

  const unknown = names.filter((name) => !isKnownFormat(name));
  if (unknown.length > 0) {
    throw new Error(
      `WAGGLE_API_RUN_FORMATS has unknown formats: ${unknown.join(", ")} ` +
        `(known: ${KNOWN_FORMATS.join(", ")})`,
    );
  }
  if (names.length === 0) {
    throw new Error("WAGGLE_API_RUN_FORMATS is empty: at least one capture format is required");
  }
  // CLI では `parseClientOptions` が同じことを言う。HTTP 経路はそこを通らないので、
  // ここが唯一この検査の在る場所。
  if (signing && !names.includes("wacz")) {
    throw new Error("WAGGLE_API_RUN_SIGNING requires wacz in WAGGLE_API_RUN_FORMATS");
  }

  const formats = Object.fromEntries(names.map((name) => [name, true]));
  return { ...formats, ...(signing ? { signing: true } : {}) };
};

/**
 * 実行を起こす関数。既定は `runClient` で、試験だけが差し替える。
 *
 * 注入できるのは、この route の試験が「走行中に 2 本目を投げると 409」を見るため ——
 * 本物の実行は分単位で終わらないので、決して解決しない stub でしか固定できない。
 */
export type RunLauncher = (options: ClientOptions) => Promise<SubmitResult[]>;

export interface RunRouteDeps {
  db: Kysely<Database>;
  fga: OpenFgaClient;
  resolveIdentity: IdentityResolver;
  launch: RunLauncher;
  /** 実行に渡す土台の設定。API からはこの一部だけを上書きできる。 */
  baseOptions: ClientOptions;
}

/** リクエストが上書きしてよい設定。ここに無いものは受け付けない。 */
interface RunBody {
  limit?: number;
}

const unauthorized = (reply: FastifyReply): FastifyReply =>
  reply.code(401).send({ error: "unauthenticated" });

/**
 * この呼び出し元が、**どれか 1 つでも**自分の組織で取り込みを起こしてよいか。
 *
 * 実行は組織ごとではなく全体に効く(`capture_targets` の enabled な行をすべて投げる)ので、
 * 「どの組織について訊くか」を選べない。許されている組織がどこかに 1 つあれば起こせる、
 * とする —— **その 1 つの許可で、他の組織の対象も投げられる**。組織を跨いで信頼できる
 * 相手にだけ `submitter` を与えること。
 *
 * **`routes.ts` と違い、contextual tuple を送らない。** あちらは `can_view` を特定の
 * archive について訊くので、所属の申告を渡しても object が組織を固定する。こちらの
 * object は呼び出し元が名乗った組織なので、所属の申告を一緒に渡すと「member だと
 * 言った者に member か訊く」形になり、検査が常に通る。実際そう書いて往復で見つけた
 * (`fga/model.fga` の `submitter` の注記)。判断材料は保存された tuple だけにする。
 */
const maySubmit = async (fga: OpenFgaClient, identity: Identity): Promise<boolean> => {
  if (identity.organizations.length === 0) return false;
  const results = await Promise.all(
    identity.organizations.map(async (org) => {
      const { allowed } = await fga.check(
        {
          user: `user:${identity.subject}`,
          relation: "can_submit",
          object: `organization:${org}`,
        },
        {
          // 取り消しが即座に効くべき側。古い許可で実行を起こさせない。
          consistency: ConsistencyPreference.HigherConsistency,
        },
      );
      return allowed === true;
    }),
  );
  return results.includes(true);
};

/** 部分 unique index の違反か。走行中の 2 本目だけがこれになる。 */
const isSingleActiveViolation = (err: unknown): boolean =>
  typeof err === "object" &&
  err !== null &&
  (err as { code?: string }).code === "23505" &&
  String((err as { constraint?: string }).constraint ?? "").includes("runs_single_active");

export const registerRunRoutes = (app: FastifyInstance, deps: RunRouteDeps): void => {
  const { db, fga, resolveIdentity, launch, baseOptions } = deps;

  /**
   * 取り込みを 1 回起こす。
   *
   * 完了は待たない。取り込みは 1 件あたり十数分に達しうるので、待てる呼び出し元が居ない
   * (`006-create-runs` を見ること)。受理したことだけを 202 で返し、続きは `runs` の行が語る。
   */
  app.post<{ Body: RunBody | undefined }>(
    "/api/runs",
    {
      schema: {
        body: {
          type: "object",
          // 知らない鍵は拒む。渡せる設定を意図して絞っている ——
          // CLI にはここから届かない検査(`--signing` は `--wacz` を要る等)が在り、
          // それらは `parseClientOptions` の中に住んでいて HTTP 経路では走らない。
          additionalProperties: false,
          properties: {
            limit: { type: "integer", minimum: 1 },
          },
        },
      },
    },
    async (request, reply) => {
      const identity = await resolveIdentity(request);
      if (!identity) return unauthorized(reply);

      if (!(await maySubmit(fga, identity))) {
        log.info({ subject: identity.subject }, "Denied");
        // `routes.ts` と同じ方針 —— 「してはいけない」と「無い」を区別させない。
        return reply.code(404).send({ error: "not found" });
      }

      const runId = randomUUID();
      try {
        await db
          .insertInto("runs")
          .values({ id: runId, status: "running", trigger: "api" })
          .execute();
      } catch (err) {
        if (isSingleActiveViolation(err)) {
          log.info({ subject: identity.subject }, "Run already in progress");
          return reply.code(409).send({ error: "a run is already in progress" });
        }
        throw err;
      }

      const options: ClientOptions = {
        ...baseOptions,
        ...(request.body?.limit === undefined ? {} : { limit: request.body.limit }),
      };

      // 待たない。この Promise の行き先は `runs` の行であって、この応答ではない。
      void launch(options)
        .then(async (results) => {
          await db
            .updateTable("runs")
            .set({
              status: "succeeded",
              finishedAt: new Date().toISOString(),
              submitted: results.length,
              accepted: results.filter((r) => r.accepted).length,
              rejected: results.filter((r) => !r.accepted).length,
            })
            .where("id", "=", runId)
            .execute();
        })
        .catch(async (err: unknown) => {
          log.error({ err, runId }, "Run failed");
          await db
            .updateTable("runs")
            .set({
              status: "failed",
              finishedAt: new Date().toISOString(),
              error: err instanceof Error ? err.message : String(err),
            })
            .where("id", "=", runId)
            .execute()
            // 記録に失敗しても、走ったこと自体は log に残っている。ここで投げても
            // 受け取る者が居ない(応答は既に返している)ので、握って log に落とす。
            .catch((updateErr: unknown) => {
              log.error({ err: updateErr, runId }, "Could not record run failure");
            });
        });

      log.info({ subject: identity.subject, runId }, "Run started");
      return reply.code(202).send({ runId });
    },
  );

  /**
   * 実行 1 回の状態。
   *
   * 走ったまま死んだ行は `running` のまま残る —— 生きているものと区別する術が行に無い。
   * 判断できるように `startedAt` をそのまま返す。片付けは運用の仕事。
   */
  app.get<{ Params: { id: string } }>(
    "/api/runs/:id",
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
        log.info({ subject: identity.subject, runId: request.params.id }, "Denied");
        return reply.code(404).send({ error: "not found" });
      }

      const run = await db
        .selectFrom("runs")
        .selectAll()
        .where("id", "=", request.params.id)
        .executeTakeFirst();

      if (!run) return reply.code(404).send({ error: "not found" });

      return reply.code(200).send({
        runId: run.id,
        status: run.status,
        trigger: run.trigger,
        startedAt: run.startedAt,
        finishedAt: run.finishedAt,
        submitted: run.submitted,
        accepted: run.accepted,
        rejected: run.rejected,
        error: run.error,
      });
    },
  );
};
