import { status } from "@grpc/grpc-js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { submitRequest } from "../src/client/submit.js";
import {
  ArchiveMode,
  CacheMode,
  type SubmitCaptureRequest,
  type SubmitCaptureResponse,
} from "../src/rpc/generated/browserhive/v1/capture.js";
import type { CaptureFormats, CaptureSettings } from "../src/types/capture.js";

/**
 * The stub is mocked at the client, not at `calls.ts`, so the promise wrapper
 * and its callback plumbing are under test too.
 */
type Callback = (error: unknown, response?: SubmitCaptureResponse) => void;
const submitCapture = vi.fn<(request: SubmitCaptureRequest, callback: Callback) => void>();

vi.mock("../src/rpc/client.js", () => ({
  getClient: () => ({ submitCapture }),
}));

const allFormats: CaptureFormats = {
  png: true,
  webp: false,
  html: false,
  links: false,
  mhtml: false,
  wacz: false,
};

const baseSettings: CaptureSettings = { captureFormats: allFormats, dismissBanners: false };

const settings = (extra: Partial<CaptureSettings> = {}): CaptureSettings => ({
  ...baseSettings,
  ...extra,
});

const accepts = (taskId: string): void => {
  submitCapture.mockImplementationOnce((_request, callback) => {
    callback(null, { accepted: true, taskId });
  });
};

/** What grpc-js hands a callback: an Error whose `message` carries the status. */
const rejects = (code: status, name: string, details: string): void => {
  submitCapture.mockImplementationOnce((_request, callback) => {
    callback(Object.assign(new Error(`${String(code)} ${name}: ${details}`), { code, details }));
  });
};

const sentRequest = (): SubmitCaptureRequest => {
  const request = submitCapture.mock.calls[0]?.[0];
  if (request === undefined) throw new Error("submitCapture was not called");
  return request;
};

describe("submitRequest", () => {
  beforeEach(() => {
    submitCapture.mockReset();
  });

  it("returns accepted=true when the call succeeds", async () => {
    accepts("task-1");

    const result = await submitRequest(
      { url: "https://example.com/", labels: ["L"], orgId: "acme" },
      settings(),
    );

    expect(result.accepted).toBe(true);
    expect(result.taskId).toBe("task-1");
    expect(result.labels).toEqual(["L"]);
    expect(result.error).toBeUndefined();
    expect(result.correlationId).toMatch(/^[a-f0-9]{8}$/);
  });

  // `message` would read "3 INVALID_ARGUMENT: url is empty". The status is
  // already logged next to this, so the bare detail is what belongs here.
  it("prefers ServiceError.details over the status-prefixed message", async () => {
    rejects(status.INVALID_ARGUMENT, "INVALID_ARGUMENT", "url is empty");

    const result = await submitRequest(
      { url: "https://example.com/", labels: [], orgId: "acme" },
      settings(),
    );

    expect(result.accepted).toBe(false);
    expect(result.error).toBe("url is empty");
    expect(result.taskId).toBe("");
  });

  // grpc-js leaves `details` empty for failures it raises itself rather than
  // ones the server described, so the message has to still come through.
  it("falls back to the message when details is empty", async () => {
    submitCapture.mockImplementationOnce((_request, callback) => {
      callback(
        Object.assign(new Error("14 UNAVAILABLE: No connection established"), {
          code: status.UNAVAILABLE,
          details: "",
        }),
      );
    });

    const result = await submitRequest(
      { url: "https://example.com/", labels: [], orgId: "acme" },
      settings(),
    );

    expect(result.accepted).toBe(false);
    expect(result.error).toBe("14 UNAVAILABLE: No connection established");
  });

  it("captures an unreachable server as accepted=false with the error message", async () => {
    submitCapture.mockImplementationOnce((_request, callback) => {
      callback(new Error("ECONNREFUSED 127.0.0.1:50051"));
    });

    const result = await submitRequest(
      { url: "https://example.com/", labels: ["X"], orgId: "acme" },
      settings(),
    );

    expect(result.accepted).toBe(false);
    expect(result.error).toBe("ECONNREFUSED 127.0.0.1:50051");
    expect(result.taskId).toBe("");
    expect(result.labels).toEqual(["X"]);
  });

  it("includes acceptLanguage in the request when provided", async () => {
    accepts("task-2");

    await submitRequest(
      { url: "https://example.com/", labels: ["L"], orgId: "acme" },
      settings({ acceptLanguage: "ja-JP,ja;q=0.9,en;q=0.8" }),
    );

    expect(sentRequest().acceptLanguage).toBe("ja-JP,ja;q=0.9,en;q=0.8");
  });

  it("omits acceptLanguage when not provided", async () => {
    accepts("task-3");

    await submitRequest(
      { url: "https://example.com/", labels: [], orgId: "acme" },
      settings({ dismissBanners: true }),
    );

    expect(sentRequest()).not.toHaveProperty("acceptLanguage");
    expect(sentRequest().dismissBannersEnabled).toBe(true);
  });

  it("sends the capture knobs when set", async () => {
    accepts("task-4");

    await submitRequest(
      { url: "https://example.com/", labels: [], orgId: "acme" },
      settings({
        deviceScaleFactor: 2,
        archiveMode: "multipass",
        operationDelayMs: 250,
        behaviors: { builtins: ["autoscroll"], siteBehaviors: false },
      }),
    );

    const request = sentRequest();
    expect(request.deviceScaleFactor).toBe(2);
    expect(request.archiveMode).toBe(ArchiveMode.ARCHIVE_MODE_MULTIPASS);
    expect(request.operationDelayMs).toBe(250);
    expect(request.behaviors).toEqual({
      builtins: ["autoscroll"],
      custom: [],
      siteBehaviors: false,
    });
  });

  // The server owns the defaults for all four, so an unset knob must not
  // reach the wire as a value the server would obey.
  it("omits every optional knob the caller did not set", async () => {
    accepts("task-5");

    await submitRequest({ url: "https://example.com/", labels: [], orgId: "acme" }, settings());

    const request = sentRequest();
    for (const key of ["deviceScaleFactor", "operationDelayMs", "behaviors"]) {
      expect(request).not.toHaveProperty(key);
    }
    // `cache` and `archiveMode` are the exception, and not by choice: a proto3
    // enum field cannot be absent. UNSPECIFIED (0) is the encoding of "the
    // caller did not say", which BrowserHive maps back to its own default —
    // so this asserts the value rather than the absence.
    expect(request.archiveMode).toBe(ArchiveMode.ARCHIVE_MODE_UNSPECIFIED);
    expect(request.cache).toBe(CacheMode.CACHE_MODE_UNSPECIFIED);
  });
});
