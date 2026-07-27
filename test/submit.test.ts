import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { submitRequest } from "../src/client/submit.js";
import type { CaptureFormats, CaptureSettings } from "../src/types/capture.js";

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

const acceptanceResponse = (taskId: string): Response =>
  new Response(JSON.stringify({ accepted: true, taskId }), {
    status: 202,
    headers: { "Content-Type": "application/json" },
  });

const problemResponse = (status: number, title: string, detail?: string): Response =>
  new Response(JSON.stringify({ status, title, ...(detail !== undefined && { detail }) }), {
    status,
    headers: { "Content-Type": "application/problem+json" },
  });

describe("submitRequest", () => {
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns accepted=true when the server replies 202", async () => {
    fetchSpy.mockResolvedValueOnce(acceptanceResponse("task-1"));

    const result = await submitRequest({ url: "https://example.com/", labels: ["L"] }, settings());

    expect(result.accepted).toBe(true);
    expect(result.taskId).toBe("task-1");
    expect(result.labels).toEqual(["L"]);
    expect(result.error).toBeUndefined();
    expect(result.correlationId).toMatch(/^[a-f0-9]{8}$/);
  });

  it("prefers Problem.detail over Problem.title for the error message", async () => {
    fetchSpy.mockResolvedValueOnce(problemResponse(400, "Validation failure", "url is empty"));

    const result = await submitRequest({ url: "https://example.com/", labels: [] }, settings());

    expect(result.accepted).toBe(false);
    expect(result.error).toBe("url is empty");
    expect(result.taskId).toBe("");
  });

  it("falls back to Problem.title when detail is missing", async () => {
    fetchSpy.mockResolvedValueOnce(problemResponse(503, "No operational workers"));

    const result = await submitRequest({ url: "https://example.com/", labels: [] }, settings());

    expect(result.accepted).toBe(false);
    expect(result.error).toBe("No operational workers");
  });

  it("captures network failures as accepted=false with the error message", async () => {
    fetchSpy.mockRejectedValueOnce(new Error("ECONNREFUSED 127.0.0.1:8080"));

    const result = await submitRequest({ url: "https://example.com/", labels: ["X"] }, settings());

    expect(result.accepted).toBe(false);
    expect(result.error).toBe("ECONNREFUSED 127.0.0.1:8080");
    expect(result.taskId).toBe("");
    expect(result.labels).toEqual(["X"]);
  });

  it("includes acceptLanguage in the request body when provided", async () => {
    fetchSpy.mockResolvedValueOnce(acceptanceResponse("task-2"));

    await submitRequest(
      { url: "https://example.com/", labels: ["L"] },
      settings({ acceptLanguage: "ja-JP,ja;q=0.9,en;q=0.8" }),
    );

    const request = fetchSpy.mock.calls[0]?.[0] as Request;
    expect(request).toBeInstanceOf(Request);
    const body = await request.text();
    const parsed = JSON.parse(body) as Record<string, unknown>;
    expect(parsed["acceptLanguage"]).toBe("ja-JP,ja;q=0.9,en;q=0.8");
  });

  it("omits acceptLanguage when not provided", async () => {
    fetchSpy.mockResolvedValueOnce(acceptanceResponse("task-3"));

    await submitRequest(
      { url: "https://example.com/", labels: [] },
      settings({ dismissBanners: true }),
    );

    const request = fetchSpy.mock.calls[0]?.[0] as Request;
    const body = await request.text();
    const parsed = JSON.parse(body) as Record<string, unknown>;
    expect(parsed).not.toHaveProperty("acceptLanguage");
    expect(parsed["dismissBanners"]).toBe(true);
  });

  it("sends the 1.6.0 capture knobs when set", async () => {
    fetchSpy.mockResolvedValueOnce(acceptanceResponse("task-4"));

    await submitRequest(
      { url: "https://example.com/", labels: [] },
      settings({
        deviceScaleFactor: 2,
        archiveMode: "multipass",
        operationDelayMs: 250,
        behaviors: { builtins: ["autoscroll"], siteBehaviors: false },
      }),
    );

    const request = fetchSpy.mock.calls[0]?.[0] as Request;
    const parsed = JSON.parse(await request.text()) as Record<string, unknown>;
    expect(parsed["deviceScaleFactor"]).toBe(2);
    expect(parsed["archiveMode"]).toBe("multipass");
    expect(parsed["operationDelayMs"]).toBe(250);
    expect(parsed["behaviors"]).toEqual({ builtins: ["autoscroll"], siteBehaviors: false });
  });

  // The server owns the defaults for all four. Sending an explicit `undefined`
  // would be a different request than sending nothing, so the keys must be
  // absent, not null.
  it("omits every optional knob the caller did not set", async () => {
    fetchSpy.mockResolvedValueOnce(acceptanceResponse("task-5"));

    await submitRequest({ url: "https://example.com/", labels: [] }, settings());

    const request = fetchSpy.mock.calls[0]?.[0] as Request;
    const parsed = JSON.parse(await request.text()) as Record<string, unknown>;
    for (const key of ["deviceScaleFactor", "archiveMode", "operationDelayMs", "behaviors"]) {
      expect(parsed).not.toHaveProperty(key);
    }
  });
});
