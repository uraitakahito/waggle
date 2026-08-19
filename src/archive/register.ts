/**
 * Put a finished capture into the ledger, and queue the tuples that make it
 * reachable — in one transaction.
 *
 * The two writes cannot be one atomic operation on their own: the archive row
 * goes to Postgres, the relationship tuples go over OpenFGA's HTTP API, and no
 * transaction spans both. Doing them independently means one can land without
 * the other, and both halves of that are bad — an archive nobody can reach, or
 * a permission pointing at a row that was rolled back.
 *
 * So the tuple write is *recorded* here as an outbox row inside the same
 * transaction as the archive. Either both land or neither does. A worker
 * delivers it afterwards, retrying until OpenFGA accepts it.
 */
import type { Kysely } from "kysely";
import {
  CaptureStatus,
  captureStatusToJSON,
  type CaptureResultReport,
} from "../rpc/generated/browserhive/v1/capture.js";
import type { Database } from "../db/database.js";
import { parseS3Uri } from "./s3-uri.js";
import { createChildLogger } from "../logger.js";

const log = createChildLogger({ module: "archive-register" });

export interface RegisterResult {
  /** `undefined` when nothing was inserted — not an error, see below. */
  archiveId?: string;
  reason?: "no-archive" | "already-known";
}

export const registerArchive = async (
  db: Kysely<Database>,
  report: CaptureResultReport,
  orgId: string,
): Promise<RegisterResult> => {
  // A failed capture uploaded nothing. Recording it would let the signing
  // endpoint hand out a URL for an object that does not exist — authorization
  // working perfectly on a 404, which is the hardest kind of broken to notice.
  // Compared against the enum, never against a string. The report is protobuf
  // now — over the wire and in the `.result.json` manifest alike — so `status`
  // is a number, and `report.status !== "success"` would have compiled fine
  // and been true for every capture ever taken.
  if (
    report.status !== CaptureStatus.CAPTURE_STATUS_SUCCESS ||
    report.artifacts?.wacz === undefined
  ) {
    log.warn(
      {
        taskId: report.taskId,
        status: captureStatusToJSON(report.status),
        error: report.errorDetails?.message,
        url: report.url,
      },
      "capture produced no archive; not adding to the ledger",
    );
    return { reason: "no-archive" };
  }

  // From the server's own report, not from rebuilding a filename.
  const { bucket, key } = parseS3Uri(report.artifacts.wacz);

  return db.transaction().execute(async (trx) => {
    const inserted = await trx
      .insertInto("archives")
      .values({
        taskId: report.taskId,
        correlationId: report.correlationId ?? null,
        bucket,
        objectKey: key,
        sourceUrl: report.url,
        labels: report.labels,
        waczComplete: report.completeness?.complete ?? null,
        capturedAt: report.timestamp,
      })
      // The poller and the reconciler can both reach the same capture, and
      // either can be retried. The unique index makes that a no-op rather
      // than a duplicate.
      .onConflict((oc) => oc.columns(["bucket", "objectKey"]).doNothing())
      .returning("id")
      .executeTakeFirst();

    // Already in the ledger, so its tuples were queued the first time. Writing
    // them again would be harmless but pointless.
    if (!inserted) return { reason: "already-known" as const };

    await trx
      .insertInto("fgaOutbox")
      .values({
        payload: JSON.stringify({
          writes: [
            {
              user: `capture_job:${report.taskId}`,
              relation: "parent",
              object: `archive:${inserted.id}`,
            },
            {
              user: `organization:${orgId}`,
              relation: "parent",
              object: `capture_job:${report.taskId}`,
            },
          ],
        }),
      })
      .execute();

    log.info(
      { archiveId: inserted.id, taskId: report.taskId, orgId, objectKey: key },
      "archive registered",
    );
    return { archiveId: inserted.id };
  });
};
