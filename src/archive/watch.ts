/**
 * Wait for a submitted capture to finish, and report what became of it.
 *
 * `SubmitCapture` is fire-and-forget, so the outcome has to be collected
 * afterwards. `GetCapture` answers per task:
 *
 *   PENDING / PROCESSING — still queued or in flight, retries included
 *   DONE                 — finished; `report.status` says whether artifacts exist
 *   NOT_FOUND (error)    — unknown, **or** evicted from the bounded result cache
 *
 * The NOT_FOUND is why this is not a two-line loop. A result ages out after
 * `--result-cache-size` newer ones (default 1000) and does not survive a
 * BrowserHive restart, so a long wait can end with the answer gone. The same
 * body is durable in the bucket as `.result.json`, so that is where this falls
 * back to — and if even that is missing, the manifest reconciler will pick the
 * task up later from a listing. Nothing is silently dropped.
 *
 * Anything that is not NOT_FOUND — an unreachable server, a broken channel —
 * propagates. Those are not "this capture is missing", and swallowing them
 * here would turn an outage into a run that quietly archives nothing.
 */
import { status } from "@grpc/grpc-js";
import { getCapture, isStatus } from "../rpc/calls.js";
import { CaptureState, type CaptureResultReport } from "../rpc/generated/browserhive/v1/capture.js";
import type { S3Client } from "@aws-sdk/client-s3";
import { getJsonObject } from "./s3.js";
import { readManifest } from "./manifest.js";
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

const readManifestFallback = async (
  taskId: string,
  correlationId: string | undefined,
  labels: string[],
  options: WatchOptions,
): Promise<CaptureResultReport | undefined> => {
  const key = manifestKey(taskId, correlationId, labels);
  const raw = await getJsonObject<unknown>(options.s3, options.bucket, key);
  if (raw !== undefined) {
    log.debug({ taskId, key }, "result was evicted from the cache; read the manifest");
    return readManifest(raw);
  }
  log.warn({ taskId, key }, "no cached result and no manifest; leaving it to reconcile");
  return undefined;
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
    let state: CaptureState;
    let report: CaptureResultReport | undefined;
    try {
      ({ state, report } = await getCapture({ taskId }));
    } catch (caught) {
      if (!isStatus(caught, status.NOT_FOUND)) throw caught;
      // Unknown task, or the result was evicted. Both look identical from
      // here, so ask the durable copy.
      return readManifestFallback(taskId, correlationId, labels, options);
    }

    // DONE without a report would mean the server contradicted itself. Treat
    // it as the same missing answer rather than returning an empty report
    // that later reads as a failed capture.
    if (state === CaptureState.CAPTURE_STATE_DONE) {
      if (report !== undefined) return report;
      log.warn({ taskId }, "capture reported DONE with no report; falling back to the manifest");
      return readManifestFallback(taskId, correlationId, labels, options);
    }

    if (Date.now() > deadline) {
      log.warn({ taskId }, "capture still running past the deadline; leaving it to reconcile");
      return undefined;
    }
    await sleep(pollIntervalMs);
  }
};
