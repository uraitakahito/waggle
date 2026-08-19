import { randomUUID } from "node:crypto";
import { submitCapture } from "../rpc/calls.js";
import { ArchiveMode, CacheMode } from "../rpc/generated/browserhive/v1/capture.js";
import { sealWire, type WireSubmitCapture } from "../rpc/wire.js";
import type { DataEntry } from "../data/url-source.js";
import type { CaptureSettings } from "../types/capture.js";

export interface SubmitResult {
  taskId: string;
  correlationId: string;
  labels: string[];
  /** Echoed back from the entry so the caller can attribute the task. */
  orgId: string;
  sourceUrl: string;
  accepted: boolean;
  error?: string;
}

const generateCorrelationId = (): string => randomUUID().replace(/-/g, "").slice(0, 8);

const ARCHIVE_MODES: Record<NonNullable<CaptureSettings["archiveMode"]>, ArchiveMode> = {
  "single-pass": ArchiveMode.ARCHIVE_MODE_SINGLE_PASS,
  multipass: ArchiveMode.ARCHIVE_MODE_MULTIPASS,
};

/**
 * Pull a human-readable string out of whatever the call rejected with.
 *
 * `details` comes first because a `ServiceError` is also an `Error`, and its
 * `message` is the status glued onto the detail — `"3 INVALID_ARGUMENT: url is
 * empty"` where `details` is just `"url is empty"`. The status is already
 * carried in the log line beside this, so the prefix is noise.
 *
 * A rejection is `unknown`, and this function's job is to never be the reason
 * a run has no error message: the later branches cover a channel that threw
 * something of its own.
 */
const extractErrorMessage = (raw: unknown): string | undefined => {
  if (typeof raw === "object" && raw !== null) {
    const details = (raw as Record<string, unknown>)["details"];
    if (typeof details === "string" && details !== "") return details;
  }
  if (raw instanceof Error) return raw.message;
  if (typeof raw === "string") return raw;
  if (typeof raw === "object" && raw !== null) {
    const message = (raw as Record<string, unknown>)["message"];
    if (typeof message === "string") return message;
  }
  return undefined;
};

/**
 * Build the wire request.
 *
 * Two shapes here are proto3's doing rather than a choice:
 *
 *   - `cache` and `archiveMode` are plain enum fields, so they cannot be
 *     absent. `*_UNSPECIFIED` (0) is how "the caller did not say" is spelled,
 *     and BrowserHive maps it back to its own default.
 *   - `behaviors.builtins` and `.custom` are `repeated`, which cannot tell an
 *     empty list from an omitted one. Sending `behaviors` with both empty is
 *     therefore *not* a way to clear the server's defaults — BrowserHive reads
 *     an empty list as "unspecified" — but the whole message is still left off
 *     when waggle has nothing to say, so the wire matches the intent.
 */
const buildRequest = (
  entry: DataEntry,
  settings: CaptureSettings,
  correlationId: string,
): WireSubmitCapture => {
  const behaviors = settings.behaviors;
  return sealWire({
    url: entry.url,
    labels: entry.labels,
    correlationId,
    captureFormats: settings.captureFormats,
    dismissBannersEnabled: settings.dismissBanners,
    cache: CacheMode.CACHE_MODE_UNSPECIFIED,
    archiveMode:
      settings.archiveMode === undefined
        ? ArchiveMode.ARCHIVE_MODE_UNSPECIFIED
        : ARCHIVE_MODES[settings.archiveMode],
    ...(settings.acceptLanguage !== undefined && { acceptLanguage: settings.acceptLanguage }),
    ...(settings.deviceScaleFactor !== undefined && {
      deviceScaleFactor: settings.deviceScaleFactor,
    }),
    ...(settings.operationDelayMs !== undefined && {
      operationDelayMs: settings.operationDelayMs,
    }),
    ...(behaviors !== undefined && {
      behaviors: {
        builtins: behaviors.builtins ?? [],
        custom: [],
        ...(behaviors.siteBehaviors !== undefined && { siteBehaviors: behaviors.siteBehaviors }),
      },
    }),
  });
};

/**
 * Send a single capture request to BrowserHive.
 *
 * Fire-and-forget: a successful call means the server has queued the work and
 * returned a `taskId`. The actual capture happens asynchronously on the server
 * side; the outcome is collected later by `waitForCapture`.
 *
 * Every failure — a rejected request, an unreachable server — is surfaced as
 * `accepted: false` in the returned `SubmitResult`. The caller never sees an
 * exception from this function.
 */
export const submitRequest = async (
  entry: DataEntry,
  settings: CaptureSettings,
): Promise<SubmitResult> => {
  const correlationId = generateCorrelationId();
  const base = {
    correlationId,
    labels: entry.labels,
    orgId: entry.orgId,
    sourceUrl: entry.url,
  };

  try {
    const response = await submitCapture(buildRequest(entry, settings, correlationId));
    // `response.accepted` is not consulted. A rejected submission arrives as a
    // non-OK status, so reaching here already means accepted — whereas reading
    // the field would let a server that forgot to set it report a queued task
    // as rejected, since proto3 booleans default to false.
    return { ...base, taskId: response.taskId, accepted: true };
  } catch (caught) {
    return {
      ...base,
      taskId: "",
      accepted: false,
      error: extractErrorMessage(caught) ?? "Unknown error",
    };
  }
};
