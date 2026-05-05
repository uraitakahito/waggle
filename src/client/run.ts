import { getCaptureFormats, logClientConfig, type ClientOptions } from "../config/cli-options.js";
import { loadUrls, type DataEntry } from "../data/url-source.js";
import { createPool } from "../db/pool.js";
import { logger } from "../logger.js";
import type { CaptureFormats } from "../types/capture.js";
import { configureClient } from "./openapi-client.js";
import { submitRequest, type SubmitResult } from "./submit.js";

/**
 * Submit every entry in parallel, logging each result as it arrives.
 * Returns once all submissions have settled.
 */
export const submitAll = async (
  entries: DataEntry[],
  captureFormats: CaptureFormats,
  dismissBanners: boolean,
  acceptLanguage: string | undefined,
): Promise<SubmitResult[]> => {
  const total = entries.length;
  let completed = 0;

  const promises = entries.map(async (entry) => {
    const result = await submitRequest(entry, captureFormats, dismissBanners, acceptLanguage);
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

  const captureFormats = getCaptureFormats(options);
  const results = await submitAll(
    entries,
    captureFormats,
    options.dismissBanners ?? false,
    options.acceptLanguage,
  );

  const totalDuration = Date.now() - startTime;
  logSummary(results, totalDuration);
};
