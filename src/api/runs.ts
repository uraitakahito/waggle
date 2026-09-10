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
 * gRPC の channel が **同じプロセスの中で** 1 つしかないので、このプロセスで 2 本並べると
 * 壊れる (`006-create-runs` に詳しい)。ここでは insert を試み、**部分 unique index の違反を
 * 409 に翻訳する**だけにしてある —— アプリ側のフラグで守ると、プロセスが増えた日に黙って破れる。
 *
 * **別プロセスの CLI (`pnpm run capture`) はこの index の外に居る。** あちらは `runs` に行を
 * 作らないため。壊れはしない (channel はプロセスごとに別) が、**同じ対象を 2 度投げる**。
 */
import type { FastifyInstance } from "fastify";
import type { OpenFgaClient } from "@openfga/sdk";
import type { Kysely } from "kysely";
import { randomUUID } from "node:crypto";
import type { Database } from "../db/database.js";
import type { IdentityResolver } from "./identity.js";
import type { ClientOptions } from "../config/cli-options.js";
import type { SubmitResult } from "../client/submit.js";
import { isUniqueViolation, maySubmit, unauthorized } from "./authorization.js";
import { createChildLogger } from "../logger.js";

const log = createChildLogger({ module: "api" });

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
          .values({ id: runId, state: "running", trigger: "api" })
          .execute();
      } catch (err) {
        if (isUniqueViolation(err, "runs_single_active")) {
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
              state: "succeeded",
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
              state: "failed",
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
        state: run.state,
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
