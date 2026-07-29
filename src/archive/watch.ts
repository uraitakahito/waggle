/**
 * Wait for a submitted capture to finish, and report what became of it.
 *
 * `POST /v1/captures` is fire-and-forget, so the outcome has to be collected
 * afterwards. BrowserHive answers per task:
 *
 *   202 — still queued or in flight, retries included
 *   200 — finished; `status` says whether artifacts exist
 *   404 — unknown, **or** evicted from the bounded result cache
 *
 * The 404 is why this is not a two-line loop. A result ages out after
 * `--result-cache-size` newer ones (default 1000) and does not survive a
 * BrowserHive restart, so a long wait can end with the answer gone. The same
 * body is durable in the bucket as `.result.json`, so that is where this falls
 * back to — and if even that is missing, the manifest reconciler will pick the
 * task up later from a listing. Nothing is silently dropped.
 */
import { getCapture } from "../http/generated/index.js";
import type { CaptureResultReport } from "../http/generated/index.js";
import type { S3Client } from "@aws-sdk/client-s3";
import { getJsonObject } from "./s3.js";
import { createChildLogger } from "../logger.js";

const log = createChildLogger({ module: "capture-watch" });

export interface WatchOptions {
  s3: S3Client;
  bucket: string;
  pollIntervalMs?: number;
  /** Give up after this long. A capture that never finishes must not hang a run. */
  timeoutMs?: number;
}

const DEFAULT_POLL_INTERVAL_MS = 2_000;
const DEFAULT_TIMEOUT_MS = 10 * 60 * 1_000;

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * The manifest sits next to the artifacts under BrowserHive's filename rule:
 * `{taskId}[_{correlationId}][_{labels}].result.json`, labels joined by `-`.
 *
 * This is the one place waggle reconstructs a key rather than reading one the
 * server handed it. Getting it wrong is not fatal — it only costs this
 * fallback, and the reconciler finds the object by listing instead.
 */
export const manifestKey = (
  taskId: string,
  correlationId: string | undefined,
  labels: string[],
): string => {
  const parts = [taskId];
  if (correlationId !== undefined && correlationId !== "") parts.push(correlationId);
  if (labels.length > 0) parts.push(labels.join("-"));
  return `${parts.join("_")}.result.json`;
};

export const waitForCapture = async (
  taskId: string,
  correlationId: string | undefined,
  labels: string[],
  options: WatchOptions,
): Promise<CaptureResultReport | undefined> => {
  const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  const deadline = Date.now() + (options.timeoutMs ?? DEFAULT_TIMEOUT_MS);

  for (;;) {
    const { data, response } = await getCapture({ path: { taskId } });
    // `GetCaptureResponses` unions the 200 body with the empty 202 one, so the
    // generated `data` widens to `{}`. The status is what disambiguates them.
    const status = response?.status;

    if (status === 200 && data) return data as CaptureResultReport;

    if (status === 202) {
      if (Date.now() > deadline) {
        log.warn({ taskId }, "capture still running past the deadline; leaving it to reconcile");
        return undefined;
      }
      await sleep(pollIntervalMs);
      continue;
    }

    // 404: unknown task, or the result was evicted. Both look identical from
    // here, so ask the durable copy.
    const key = manifestKey(taskId, correlationId, labels);
    const manifest = await getJsonObject<CaptureResultReport>(options.s3, options.bucket, key);
    if (manifest) {
      log.debug({ taskId, key }, "result was evicted from the cache; read the manifest");
      return manifest;
    }
    log.warn({ taskId, key, status }, "no cached result and no manifest; leaving it to reconcile");
    return undefined;
  }
};
