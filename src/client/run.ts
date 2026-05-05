import { readFile } from "node:fs/promises";
import { getCaptureFormats, logClientConfig, type ClientOptions } from "../config/cli-options.js";
import { parseDataFile, type DataEntry } from "../data/yaml-loader.js";
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
 * Top-level orchestration: read the data file, configure the client,
 * submit every entry, and log the summary.
 */
export const runClient = async (options: ClientOptions): Promise<void> => {
  const startTime = Date.now();

  logClientConfig(options);
  configureClient(options.server);

  const fileContent = await readFile(options.data, "utf-8");
  const parseResult = parseDataFile(fileContent);
  if (!parseResult.ok) {
    logger.fatal({ file: options.data, error: parseResult.error }, "Failed to parse data file");
    process.exit(1);
  }
  let entries = parseResult.value;
  const totalInFile = entries.length;

  if (options.limit !== undefined && options.limit > 0) {
    entries = entries.slice(0, options.limit);
  }

  logger.info({ count: entries.length, total: totalInFile }, "Loaded entries from data file");

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
