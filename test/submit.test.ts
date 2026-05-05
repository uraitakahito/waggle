import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { submitRequest } from "../src/client/submit.js";
import type { CaptureFormats } from "../src/types/capture.js";

const allFormats: CaptureFormats = {
  png: true,
  jpeg: false,
  html: false,
  links: false,
  pdf: false,
};

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

    const result = await submitRequest(
      { url: "https://example.com/", labels: ["L"] },
      allFormats,
      false,
      undefined,
    );

    expect(result.accepted).toBe(true);
    expect(result.taskId).toBe("task-1");
    expect(result.labels).toEqual(["L"]);
    expect(result.error).toBeUndefined();
    expect(result.correlationId).toMatch(/^[a-f0-9]{8}$/);
  });

  it("prefers Problem.detail over Problem.title for the error message", async () => {
    fetchSpy.mockResolvedValueOnce(problemResponse(400, "Validation failure", "url is empty"));

    const result = await submitRequest(
      { url: "https://example.com/", labels: [] },
      allFormats,
      false,
      undefined,
    );

    expect(result.accepted).toBe(false);
    expect(result.error).toBe("url is empty");
    expect(result.taskId).toBe("");
  });

  it("falls back to Problem.title when detail is missing", async () => {
    fetchSpy.mockResolvedValueOnce(problemResponse(503, "No operational workers"));

    const result = await submitRequest(
      { url: "https://example.com/", labels: [] },
      allFormats,
      false,
      undefined,
    );

    expect(result.accepted).toBe(false);
    expect(result.error).toBe("No operational workers");
  });

  it("captures network failures as accepted=false with the error message", async () => {
    fetchSpy.mockRejectedValueOnce(new Error("ECONNREFUSED 127.0.0.1:8080"));

    const result = await submitRequest(
      { url: "https://example.com/", labels: ["X"] },
      allFormats,
      false,
      undefined,
    );

    expect(result.accepted).toBe(false);
    expect(result.error).toBe("ECONNREFUSED 127.0.0.1:8080");
    expect(result.taskId).toBe("");
    expect(result.labels).toEqual(["X"]);
  });

  it("includes acceptLanguage in the request body when provided", async () => {
    fetchSpy.mockResolvedValueOnce(acceptanceResponse("task-2"));

    await submitRequest(
      { url: "https://example.com/", labels: ["L"] },
      allFormats,
      false,
      "ja-JP,ja;q=0.9,en;q=0.8",
    );

    const request = fetchSpy.mock.calls[0]?.[0] as Request;
    expect(request).toBeInstanceOf(Request);
    const body = await request.text();
    const parsed = JSON.parse(body) as Record<string, unknown>;
    expect(parsed["acceptLanguage"]).toBe("ja-JP,ja;q=0.9,en;q=0.8");
  });

  it("omits acceptLanguage when not provided", async () => {
    fetchSpy.mockResolvedValueOnce(acceptanceResponse("task-3"));

    await submitRequest({ url: "https://example.com/", labels: [] }, allFormats, true, undefined);

    const request = fetchSpy.mock.calls[0]?.[0] as Request;
    const body = await request.text();
    const parsed = JSON.parse(body) as Record<string, unknown>;
    expect(parsed).not.toHaveProperty("acceptLanguage");
    expect(parsed["dismissBanners"]).toBe(true);
  });
});
