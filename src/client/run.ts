import type { Kysely } from "kysely";
import { getCaptureSettings, logClientConfig, type ClientOptions } from "../config/cli-options.js";
import { storageConfig } from "../config/env.js";
import { loadUrls, type DataEntry } from "../data/url-source.js";
import { createPool } from "../db/pool.js";
import { createKyselyClient } from "../db/kysely.js";
import type { Database } from "../db/database.js";
import { createS3Client } from "../archive/s3.js";
import { waitForCapture } from "../archive/watch.js";
import { registerArchive } from "../archive/register.js";
import { logger } from "../logger.js";
import type { CaptureSettings } from "../types/capture.js";
import { configureClient } from "./openapi-client.js";
import { submitRequest, type SubmitResult } from "./submit.js";

/**
 * Submit every entry in parallel, logging each result as it arrives.
 * Returns once all submissions have settled.
 */
export const submitAll = async (
  entries: DataEntry[],
  settings: CaptureSettings,
): Promise<SubmitResult[]> => {
  const total = entries.length;
  let completed = 0;

  const promises = entries.map(async (entry) => {
    const result = await submitRequest(entry, settings);
    completed++;

    if (result.accepted) {
      logger.info(
        {
          progress: `${String(completed)}/${String(total)}`,
          taskId: result.taskId,
          correlationId: result.correlationId,
          labels: result.labels,
        },
        "Request accepted",
      );
    } else {
      logger.warn(
        {
          progress: `${String(completed)}/${String(total)}`,
          taskId: result.taskId,
          correlationId: result.correlationId,
          labels: result.labels,
          error: result.error ?? "Unknown error",
        },
        "Request rejected",
      );
    }

    return result;
  });

  return Promise.all(promises);
};

const logSummary = (results: SubmitResult[], totalDuration: number): void => {
  const acceptedCount = results.filter((r) => r.accepted).length;
  const rejectedCount = results.filter((r) => !r.accepted).length;

  logger.info(
    {
      total: results.length,
      accepted: acceptedCount,
      rejected: rejectedCount,
      durationMs: totalDuration,
    },
    "Request summary",
  );
};

/**
 * Record which organization each accepted task belongs to.
 *
 * Written before anything waits on the capture, because this is the only
 * place that knows. BrowserHive has no concept of an organization, so a
 * result recovered later from a manifest carries nothing that identifies one —
 * without this row the reconciler could not attribute the archive.
 */
const recordSubmissions = async (db: Kysely<Database>, results: SubmitResult[]): Promise<void> => {
  const accepted = results.filter((r) => r.accepted);
  if (accepted.length === 0) return;

  await db
    .insertInto("captureSubmissions")
    .values(
      accepted.map((r) => ({
        taskId: r.taskId,
        correlationId: r.correlationId,
        orgId: r.orgId,
        submittedBy: null,
        sourceUrl: r.sourceUrl,
      })),
    )
    // A resubmitted taskId cannot happen (the server generates it), but a
    // retried run of this function can.
    .onConflict((oc) => oc.column("taskId").doNothing())
    .execute();
};

/**
 * Wait for every accepted task and add the ones that produced an archive to
 * the ledger.
 *
 * Failures here are deliberately not fatal to the run: a capture that never
 * reports, or a ledger write that loses a race, is picked up later by
 * `waggle fga:reconcile` from the durable manifests. The point of this pass is
 * latency, not correctness — correctness is the reconciler's job.
 */
const collectResults = async (
  db: Kysely<Database>,
  results: SubmitResult[],
  options: ClientOptions,
): Promise<void> => {
  const storage = storageConfig();
  const s3 = createS3Client(storage);
  const accepted = results.filter((r) => r.accepted);

  for (const result of accepted) {
    try {
      const report = await waitForCapture(result.taskId, result.correlationId, result.labels, {
        s3,
        bucket: storage.bucket,
        ...(options.captureTimeoutMs !== undefined && { timeoutMs: options.captureTimeoutMs }),
      });
      if (!report) continue;
      await registerArchive(db, report, result.orgId);
    } catch (caught) {
      logger.warn(
        { err: caught, taskId: result.taskId },
        "Could not collect this capture; reconcile will retry",
      );
    }
  }
};

/**
 * Top-level orchestration: load URLs from Postgres, configure the
 * client, submit every entry, and log the summary.
 */
export const runClient = async (options: ClientOptions): Promise<void> => {
  const startTime = Date.now();

  logClientConfig(options);
  configureClient(options.server);

  const pool = createPool(options.databaseUrl);
  let entries: DataEntry[];
  try {
    entries = await loadUrls(pool, {
      ...(options.limit !== undefined && { limit: options.limit }),
    });
  } finally {
    await pool.end();
  }

  logger.info({ count: entries.length }, "Loaded entries from database");

  if (entries.length === 0) {
    logger.info("No entries to process");
    return;
  }

  const results = await submitAll(entries, getCaptureSettings(options));

  const db = createKyselyClient(options.databaseUrl);
  try {
    await recordSubmissions(db, results);
    if (options.collect !== false) {
      await collectResults(db, results, options);
    }
  } finally {
    await db.destroy();
  }

  const totalDuration = Date.now() - startTime;
  logSummary(results, totalDuration);
};
