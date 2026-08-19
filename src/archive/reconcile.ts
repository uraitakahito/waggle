/**
 * Fill gaps in the ledger from the durable result manifests in the bucket.
 *
 * The polling pass in `run.ts` only works while waggle is running. If it was
 * down, restarted, or the result aged out of BrowserHive's bounded cache
 * before it looked, that capture never reaches the ledger — and nothing
 * afterwards would reveal that it is missing. A ledger with unnoticed holes is
 * worse than no ledger, because the holes only surface as "why can't I see
 * this archive?" much later.
 *
 * BrowserHive writes a `.result.json` next to every capture's artifacts, for
 * failures as well as successes, with the same lifetime as the artifacts. So
 * the bucket is a complete record, and this walks it.
 *
 * ## Scale
 *
 * S3 list narrows by prefix only — no suffix filter, no "modified since" — so
 * this pulls the full listing and selects manifests here. Fine at the current
 * scale (tens of objects). At tens of thousands the fix is a date prefix on
 * BrowserHive's keys, not a cleverer listing.
 */
import type { Kysely } from "kysely";
import type { S3Client } from "@aws-sdk/client-s3";
import { readManifest } from "./manifest.js";
import type { Database } from "../db/database.js";
import { getJsonObject, listAllKeys } from "./s3.js";
import { registerArchive } from "./register.js";
import { createChildLogger } from "../logger.js";

const log = createChildLogger({ module: "archive-reconcile" });

const MANIFEST_SUFFIX = ".result.json";

export interface ReconcileResult {
  manifests: number;
  registered: number;
  skipped: number;
  unattributed: number;
}

/**
 * The task id is the first `_`-delimited part of a manifest key (BrowserHive
 * builds names as `{taskId}[_{correlationId}][_{labels}].{ext}`), so it can be
 * read without fetching the object. That keeps the common case — a manifest
 * already in the ledger — to zero GETs.
 */
const taskIdFromKey = (key: string): string =>
  key.slice(0, -MANIFEST_SUFFIX.length).split("_")[0] ?? "";

export const reconcile = async (
  db: Kysely<Database>,
  s3: S3Client,
  bucket: string,
): Promise<ReconcileResult> => {
  const keys = await listAllKeys(s3, bucket);
  const manifests = keys.filter((key) => key.endsWith(MANIFEST_SUFFIX));

  // One query rather than one per manifest.
  const knownRows = await db.selectFrom("archives").select("taskId").execute();
  const known = new Set(knownRows.map((row) => row.taskId));

  const result: ReconcileResult = {
    manifests: manifests.length,
    registered: 0,
    skipped: 0,
    unattributed: 0,
  };

  for (const key of manifests) {
    const taskId = taskIdFromKey(key);
    if (taskId === "" || known.has(taskId)) {
      result.skipped += 1;
      continue;
    }

    // Which organization this was for is not in the manifest — BrowserHive has
    // no such concept. `capture_submissions` is the record waggle wrote when it
    // submitted the job; without it the archive cannot be attributed, and
    // guessing would be worse than leaving it out.
    const submission = await db
      .selectFrom("captureSubmissions")
      .select("orgId")
      .where("taskId", "=", taskId)
      .executeTakeFirst();
    if (!submission) {
      result.unattributed += 1;
      log.warn(
        { taskId, key },
        "Manifest has no matching submission; cannot attribute it to an organization",
      );
      continue;
    }

    const raw = await getJsonObject<unknown>(s3, bucket, key);
    if (raw === undefined) {
      // Listed a moment ago, gone now. Nothing to do but note it.
      log.warn({ key }, "Manifest disappeared between listing and read");
      result.skipped += 1;
      continue;
    }

    // Idempotent: the unique index absorbs a race with the polling path.
    const registered = await registerArchive(db, readManifest(raw), submission.orgId);
    if (registered.archiveId !== undefined) result.registered += 1;
    else result.skipped += 1;
  }

  log.info(result, "Reconcile complete");
  return result;
};
