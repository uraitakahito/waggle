import { randomUUID } from "node:crypto";
import { submitCapture, type CaptureRequest } from "../http/generated/index.js";
import type { DataEntry } from "../data/yaml-loader.js";
import type { CaptureFormats } from "../types/capture.js";

export interface SubmitResult {
  taskId: string;
  correlationId: string;
  labels: string[];
  accepted: boolean;
  error?: string;
}

const generateCorrelationId = (): string => randomUUID().replace(/-/g, "").slice(0, 8);

/**
 * Pull a human-readable string out of whatever the hey-api client puts
 * into the `error` field. The OpenAPI-typed shape is `Problem` (with
 * `detail` / `title`), but on a transport failure the client returns
 * the raw thrown `Error` (or a string), so we widen to `unknown` and
 * narrow at runtime.
 */
const extractErrorMessage = (raw: unknown): string | undefined => {
  if (raw instanceof Error) return raw.message;
  if (typeof raw === "string") return raw;
  if (typeof raw === "object" && raw !== null) {
    const obj = raw as Record<string, unknown>;
    if (typeof obj["detail"] === "string") return obj["detail"];
    if (typeof obj["title"] === "string") return obj["title"];
  }
  return undefined;
};

/**
 * Send a single capture request to BrowserHive.
 *
 * Fire-and-forget: a 202 response means the server has queued the work
 * and returned a `taskId`. The actual capture happens asynchronously on
 * the server side; lifecycle tracking is the responsibility of later
 * stages (Stage 1+ of the waggle roadmap).
 *
 * Errors — both HTTP-level (4xx/5xx Problem responses) and transport
 * failures (network errors thrown by `fetch`) — are surfaced as
 * `accepted: false` in the returned `SubmitResult`. The caller never
 * sees an exception from this function.
 */
export const submitRequest = async (
  entry: DataEntry,
  captureFormats: CaptureFormats,
  dismissBanners: boolean,
  acceptLanguage: string | undefined,
): Promise<SubmitResult> => {
  const correlationId = generateCorrelationId();
  const body: CaptureRequest = {
    url: entry.url,
    labels: entry.labels,
    correlationId,
    captureFormats,
    dismissBanners,
    ...(acceptLanguage !== undefined && { acceptLanguage }),
  };

  try {
    const { data, error, response } = await submitCapture({ body });
    if (response?.status === 202 && data) {
      return {
        taskId: data.taskId,
        correlationId,
        labels: entry.labels,
        accepted: true,
      };
    }
    const status = response?.status;
    const message =
      extractErrorMessage(error) ??
      (status !== undefined ? `HTTP ${String(status)}` : "Network error");
    return {
      taskId: "",
      correlationId,
      labels: entry.labels,
      accepted: false,
      error: message,
    };
  } catch (caught) {
    const errorMessage = caught instanceof Error ? caught.message : String(caught);
    return {
      taskId: "",
      correlationId,
      labels: entry.labels,
      accepted: false,
      error: errorMessage,
    };
  }
};
