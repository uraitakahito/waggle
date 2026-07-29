/**
 * The Policy Enforcement Point.
 *
 * S3 only checks a signature, so the moment a URL is signed the decision is
 * already made and cannot be taken back. That makes the line before
 * `presignArchive` the single place authorization can be enforced — every
 * other check is advisory. Nothing here may hand out a URL without a Check
 * immediately preceding it.
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

/** Rows returned per page of the archive list. */
const PAGE_SIZE = 50;

/**
 * Membership as contextual tuples, rebuilt from the caller's identity on every
 * request. Nothing about who belongs to which organization is persisted in
 * OpenFGA, so there is no membership to keep in sync — and no window where the
 * authorization store disagrees with the identity provider.
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
   * Issue a signed URL for one archive.
   *
   * A denial answers 404, not 403. A 403 would confirm that this id names a
   * real archive, which is exactly what an enumeration attempt is looking for
   * — the leak OWASP API1:2023 (Broken Object Level Authorization) warns about.
   * "You may not see it" and "it does not exist" have to be indistinguishable.
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
        // The one place staleness is not acceptable. A cached allow here hands
        // out a URL that stays valid for its whole lifetime, so a revocation
        // that landed a second ago must already be visible.
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

    // Allowed by the model but absent from the ledger: a tuple outlived its
    // archive. Same 404 — there is nothing to sign.
    if (!location) {
      log.warn({ archiveId: id }, "Check allowed an archive that is not in the ledger");
      return reply.code(404).send({ error: "not found" });
    }

    const signed = await presignArchive(s3, location);
    log.info({ subject: identity.subject, archiveId: id }, "Signed URL issued");
    return reply.code(200).send(signed);
  });

  /**
   * List the archives this caller may see, newest first.
   *
   * Paginate in SQL, then ask about that page. `ListObjects` would answer the
   * same question in one call, but it is capped (1,000 results by default) and
   * gets more expensive as the corpus grows, whereas this stays proportional
   * to the page.
   *
   * Default consistency — the cache is fine here. Appearing in a list grants
   * nothing: fetching any of these still has to pass the strongly consistent
   * Check above.
   */
  app.get("/api/archives", async (request: FastifyRequest, reply: FastifyReply) => {
    const identity = await resolveIdentity(request);
    if (!identity) return unauthorized(reply);

    const { before } = request.query as { before?: string };
    let query = db
      .selectFrom("archives")
      .select(["id", "taskId", "sourceUrl", "labels", "waczComplete", "capturedAt"])
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
        // batchCheck wraps contextual tuples in `tuple_keys`; the single
        // `check` above takes a bare array. Same concept, different shape.
        contextualTuples: { tuple_keys: contextualTuples },
        context: { current_time: now },
        // Correlates responses with requests — order is not guaranteed. Not
        // related to BrowserHive's capture `correlationId`, which is a
        // different concept with the same name.
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
