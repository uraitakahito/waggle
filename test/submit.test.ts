import { status } from "@grpc/grpc-js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { submitRequest } from "../src/client/submit.js";
import {
  CacheMode,
  type SubmitCaptureRequest,
  type SubmitCaptureResponse,
} from "../src/rpc/generated/browserhive/v1/capture.js";
import type { CaptureFormats, CaptureSettings } from "../src/types/capture.js";

/**
 * stub を差し込むのは `calls.ts` ではなく client の側。こうすると Promise の
 * ラッパと callback の配線までテストの対象に入る。
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

/** grpc-js が callback に渡すもの: `message` が status を運ぶ Error。 */
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

  // `message` なら "3 INVALID_ARGUMENT: url is empty" になる。status は隣で既に
  // ログに出ているので、ここに置くべきなのは素の detail のほう。
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

  // server が述べた失敗ではなく grpc-js 自身が起こした失敗では `details` が空に
  // なるので、message のほうは依然として通らなければならない。
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
        devicePixelRatios: [1, 2],
        operationDelayMs: 250,
        behaviors: { builtins: ["autoscroll"], siteBehaviors: false },
      }),
    );

    const request = sentRequest();
    // 順序まで見る: PNG / WebP は最後の要素の倍率で出るので、[1, 2] と [2, 1] は
    // 別の指示。集合として比べると、その違いを取り落とす。
    expect(request.devicePixelRatios).toEqual([1, 2]);
    expect(request.operationDelayMs).toBe(250);
    // built-in は 1 件 1 枝で並ぶ。id の文字列ではなく型の枝なので、`autoscrol` の
    // ような綴りはそもそも wire に載らない。
    expect(request.behaviors).toEqual({
      behaviors: { items: [{ autoscroll: {} }] },
      siteBehaviors: false,
    });
  });

  it("空の builtins は「1 つも走らせない」として届く", async () => {
    // v4.0.0 より前は、これが server 既定に化けていた —— proto3 の repeated には
    // presence が無く、空と未指定を区別できなかったため。
    accepts("task-4b");

    await submitRequest(
      { url: "https://example.com/", labels: [], orgId: "acme" },
      settings({ behaviors: { builtins: [] } }),
    );

    expect(sentRequest().behaviors).toEqual({ behaviors: { items: [] } });
  });

  // 4 つとも既定値を持っているのは server なので、設定していない調整が、server が
  // 従ってしまう値として wire に出てはならない。
  it("omits every optional knob the caller did not set", async () => {
    accepts("task-5");

    await submitRequest({ url: "https://example.com/", labels: [], orgId: "acme" }, settings());

    const request = sentRequest();
    for (const key of ["operationDelayMs", "behaviors"]) {
      expect(request).not.toHaveProperty(key);
    }
    // `cache` と `devicePixelRatios` は例外で、選んだ結果ではない: proto3 の
    // enum field は不在になれず、repeated も同じ。UNSPECIFIED (0) と `[]` が
    // 「呼ぶ側は何も言わなかった」の綴りで、BrowserHive はどちらも自分の既定値に
    // 戻す —— なのでここは不在ではなく値のほうを主張している。
    expect(request.cache).toBe(CacheMode.CACHE_MODE_UNSPECIFIED);
    expect(request.devicePixelRatios).toEqual([]);
  });
});
