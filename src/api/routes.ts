/**
 * Policy Enforcement Point —— 認可を実際に強制する 1 点。
 *
 * S3 は署名しか見ないので、URL に署名した瞬間に判断は済んでいて、取り消せない。
 * つまり `presignArchive` の直前の 1 行が、認可を強制できる唯一の場所になる ——
 * 他の検査はすべて助言でしかない。ここでは、直前に Check を置かずに URL を配って
 * はならない。
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { S3Client } from "@aws-sdk/client-s3";
import type { OpenFgaClient } from "@openfga/sdk";
import { ConsistencyPreference } from "@openfga/sdk";
import type { Kysely } from "kysely";
import type { Database } from "../db/database.js";
import type { Identity, IdentityResolver } from "./identity.js";
import { presignArchive } from "./presign.js";
import { createChildLogger } from "../logger.js";

const log = createChildLogger({ module: "api" });

export interface RouteDeps {
  db: Kysely<Database>;
  fga: OpenFgaClient;
  s3: S3Client;
  resolveIdentity: IdentityResolver;
}

/** アーカイブ一覧 1 ページあたりの行数。 */
const PAGE_SIZE = 50;

/**
 * 所属を contextual tuple として、リクエストのたびに呼び出し元の identity から
 * 組み直す。誰がどの組織に属するかは OpenFGA に一切保存しないので、同期を保つべき
 * 所属が存在しない —— 認可ストアと identity provider が食い違う窓も無い。
 */
const membershipTuples = (identity: Identity) =>
  identity.organizations.map((org) => ({
    user: `user:${identity.subject}`,
    relation: "member",
    object: `organization:${org}`,
  }));

const unauthorized = (reply: FastifyReply): FastifyReply =>
  reply.code(401).send({ error: "unauthenticated" });

export const registerRoutes = (app: FastifyInstance, deps: RouteDeps): void => {
  const { db, fga, s3, resolveIdentity } = deps;

  /**
   * アーカイブ 1 本に対して署名付き URL を発行する。
   *
   * 拒否は 403 ではなく 404 で答える。403 は「この id は実在するアーカイブを
   * 指している」ことを確認してしまい、それはまさに列挙を試みる側が欲しい情報 ——
   * OWASP API1:2023 (Broken Object Level Authorization) が警告している漏れ。
   * 「見てはいけない」と「存在しない」は区別が付いてはならない。
   */
  app.post("/api/archives/:id/url", async (request: FastifyRequest, reply: FastifyReply) => {
    const identity = await resolveIdentity(request);
    if (!identity) return unauthorized(reply);

    const { id } = request.params as { id: string };

    const { allowed } = await fga.check(
      {
        user: `user:${identity.subject}`,
        relation: "can_view",
        object: `archive:${id}`,
        contextualTuples: membershipTuples(identity),
        context: { current_time: new Date().toISOString() },
      },
      {
        // 古い答えが許されない唯一の場所。ここでキャッシュされた許可は、寿命の
        // 間ずっと有効な URL を配ってしまうので、1 秒前に入った取り消しが既に
        // 見えていなければならない。
        consistency: ConsistencyPreference.HigherConsistency,
      },
    );

    if (allowed !== true) {
      log.info({ subject: identity.subject, archiveId: id }, "Denied");
      return reply.code(404).send({ error: "not found" });
    }

    const location = await db
      .selectFrom("archives")
      .select(["bucket", "objectKey"])
      .where("id", "=", id)
      .executeTakeFirst();

    // モデル上は許されているが台帳に無い: tuple がアーカイブより長生きした場合。
    // 同じ 404 —— 署名する相手が無い。
    if (!location) {
      log.warn({ archiveId: id }, "Check allowed an archive that is not in the ledger");
      return reply.code(404).send({ error: "not found" });
    }

    const signed = await presignArchive(s3, location);
    log.info({ subject: identity.subject, archiveId: id }, "Signed URL issued");
    return reply.code(200).send(signed);
  });

  /**
   * この呼び出し元が見てよいアーカイブを、新しい順に並べる。
   *
   * SQL でページを切ってから、そのページについて訊く。`ListObjects` なら同じ問いに
   * 1 回で答えられるが、上限があり (既定で 1,000 件)、蓄積が増えるほど高くつく。
   * こちらはページの大きさに比例したままでいられる。
   *
   * 一貫性は既定のまま —— ここではキャッシュで構わない。一覧に出ることは何も
   * 与えない: どれかを取りに行くには、上の強一貫な Check を通る必要がある。
   */
  app.get("/api/archives", async (request: FastifyRequest, reply: FastifyReply) => {
    const identity = await resolveIdentity(request);
    if (!identity) return unauthorized(reply);

    const { before } = request.query as { before?: string };
    let query = db
      .selectFrom("archives")
      // objectKey は picker が replay へ渡す鍵。bucket は返さない —— replay は
      // 自分の S3_BUCKET_URL で既に持っていて、両方返すと「どちらが正か」が
      // 2 つになる。
      .select(["id", "taskId", "sourceUrl", "labels", "waczComplete", "capturedAt", "objectKey"])
      .orderBy("capturedAt", "desc")
      .limit(PAGE_SIZE);
    if (before !== undefined) query = query.where("capturedAt", "<", new Date(before));
    const page = await query.execute();

    if (page.length === 0) return reply.code(200).send({ archives: [] });

    const now = new Date().toISOString();
    const contextualTuples = membershipTuples(identity);
    const result = await fga.batchCheck({
      checks: page.map((archive) => ({
        user: `user:${identity.subject}`,
        relation: "can_view",
        object: `archive:${archive.id}`,
        // batchCheck は contextual tuple を `tuple_keys` で包む。上の単発の
        // `check` は素の配列を取る。概念は同じで、形が違う。
        contextualTuples: { tuple_keys: contextualTuples },
        context: { current_time: now },
        // 応答とリクエストを対応付けるためのもの —— 順序は保証されない。
        // BrowserHive の取り込みの `correlationId` とは無関係で、名前が同じだけの
        // 別概念。
        correlationId: archive.id.replace(/-/g, ""),
      })),
    });

    const allowed = new Set(
      result.result.filter((entry) => entry.allowed === true).map((entry) => entry.request.object),
    );
    return reply
      .code(200)
      .send({ archives: page.filter((archive) => allowed.has(`archive:${archive.id}`)) });
  });

  app.get("/healthz", (_request, reply) => reply.code(200).send({ status: "ok" }));
};
