import { beforeEach, describe, expect, it, vi } from "vitest";
import { status } from "@grpc/grpc-js";
import {
  CaptureState,
  CaptureStatus,
  type GetCaptureProgressResponse,
} from "../src/rpc/generated/browserhive/v1/capture.js";

/**
 * 待ちループの分岐を、時計を進めずに確かめる。
 *
 * いちばん見たいのは **NOT_FOUND が 2 経路になったこと**。GetCaptureProgress で
 * 待ち、DONE を見てから GetCapture で結果を取るので、押し出しはどちらでも起こる。
 * 片方を拾い忘れると、**まさに調べる価値のある取り込みだけ**が manifest に
 * 落ちずに例外で落ちる —— 成功した取り込みでは決して再現しない壊れ方になる。
 */
vi.mock("../src/rpc/calls.js", () => ({
  getCapture: vi.fn(),
  getCaptureProgress: vi.fn(),
  getServerStatus: vi.fn(),
  isStatus: (error: unknown, expected: number): boolean =>
    typeof error === "object" && error !== null && (error as { code?: number }).code === expected,
}));
vi.mock("../src/archive/s3.js", () => ({ getJsonObject: vi.fn() }));

const { getCapture, getCaptureProgress, getServerStatus } = await import("../src/rpc/calls.js");
const { getJsonObject } = await import("../src/archive/s3.js");
const { waitForCapture } = await import("../src/archive/watch.js");

const notFound = Object.assign(new Error("unknown taskId"), { code: status.NOT_FOUND });

/** BrowserHive が bucket に書くとおりの `.result.json`。 */
const manifest = {
  taskId: "t1",
  url: "https://example.com/",
  labels: [],
  status: "CAPTURE_STATUS_SUCCESS",
  timestamp: "2026-08-30T00:00:00.000Z",
  captureProcessingTimeMs: 100,
  retryCount: 0,
  workerIndex: 0,
  artifacts: { wacz: "s3://b/t1.wacz" },
};

const options = {
  s3: {} as never,
  bucket: "b",
  pollIntervalMs: 1,
  pendingPatienceMs: 20,
  overrunGraceMs: 20,
};

const progress = (
  state: CaptureState,
  extra: Partial<NonNullable<GetCaptureProgressResponse["progress"]>> = {},
): GetCaptureProgressResponse => ({
  state,
  progress: { queuedMs: 0, retryCount: 0, ...extra },
});

describe("waitForCapture", () => {
  beforeEach(() => {
    vi.mocked(getCapture).mockReset();
    vi.mocked(getCaptureProgress).mockReset();
    vi.mocked(getServerStatus).mockReset();
    vi.mocked(getJsonObject).mockReset();
  });

  it("DONE を見たら GetCapture で結果を取る", async () => {
    vi.mocked(getCaptureProgress).mockResolvedValue(progress(CaptureState.CAPTURE_STATE_DONE));
    vi.mocked(getCapture).mockResolvedValue({
      state: CaptureState.CAPTURE_STATE_DONE,
      report: { taskId: "t1", status: CaptureStatus.CAPTURE_STATUS_SUCCESS },
    } as never);

    const report = await waitForCapture("t1", undefined, [], options);

    expect(report?.taskId).toBe("t1");
    // 待っている間に GetCapture は引かない —— あちらは結果を取るための RPC。
    expect(vi.mocked(getCapture)).toHaveBeenCalledTimes(1);
  });

  it("GetCaptureProgress の NOT_FOUND は manifest に落ちる", async () => {
    vi.mocked(getCaptureProgress).mockRejectedValue(notFound);
    vi.mocked(getJsonObject).mockResolvedValue(manifest);

    const report = await waitForCapture("t1", undefined, [], options);

    expect(report?.artifacts?.wacz).toBe("s3://b/t1.wacz");
    expect(vi.mocked(getJsonObject)).toHaveBeenCalledTimes(1);
  });

  it("GetCapture の NOT_FOUND も manifest に落ちる —— DONE を見てから押し出されうる", async () => {
    vi.mocked(getCaptureProgress).mockResolvedValue(progress(CaptureState.CAPTURE_STATE_DONE));
    vi.mocked(getCapture).mockRejectedValue(notFound);
    vi.mocked(getJsonObject).mockResolvedValue(manifest);

    const report = await waitForCapture("t1", undefined, [], options);

    expect(report?.artifacts?.wacz).toBe("s3://b/t1.wacz");
  });

  it("report の無い DONE も manifest に落ちる", async () => {
    vi.mocked(getCaptureProgress).mockResolvedValue(progress(CaptureState.CAPTURE_STATE_DONE));
    vi.mocked(getCapture).mockResolvedValue({ state: CaptureState.CAPTURE_STATE_DONE });
    vi.mocked(getJsonObject).mockResolvedValue(manifest);

    const report = await waitForCapture("t1", undefined, [], options);

    expect(report?.artifacts?.wacz).toBe("s3://b/t1.wacz");
  });

  it("NOT_FOUND 以外の失敗は飲み込まない", async () => {
    vi.mocked(getCaptureProgress).mockRejectedValue(
      Object.assign(new Error("no connection"), { code: status.UNAVAILABLE }),
    );

    await expect(waitForCapture("t1", undefined, [], options)).rejects.toThrow("no connection");
    // 届かない server を manifest フォールバックで隠すと、障害が
    // 「静かに何もアーカイブしない実行」に化ける。
    expect(vi.mocked(getJsonObject)).not.toHaveBeenCalled();
  });

  it("server が宣言した予算を超えたら諦める —— 自前の締切は持たない", async () => {
    // 「あと 1ms」と宣言し続ける server。猶予 (20ms) を過ぎたら異常と見なす。
    vi.mocked(getCaptureProgress).mockResolvedValue(
      progress(CaptureState.CAPTURE_STATE_PROCESSING, { worstCaseRemainingMs: 1 }),
    );

    const report = await waitForCapture("t1", undefined, [], options);

    expect(report).toBeUndefined();
    // 諦めた理由は server 側なので、manifest は引かない (まだ書かれていない)。
    expect(vi.mocked(getJsonObject)).not.toHaveBeenCalled();
  });

  it("宣言が届いている間は待ち続ける", async () => {
    // 十分な予算を宣言していれば、猶予を過ぎても打ち切らない。
    vi.mocked(getCaptureProgress)
      .mockResolvedValueOnce(
        progress(CaptureState.CAPTURE_STATE_PROCESSING, { worstCaseRemainingMs: 60_000 }),
      )
      .mockResolvedValueOnce(
        progress(CaptureState.CAPTURE_STATE_PROCESSING, { worstCaseRemainingMs: 59_000 }),
      )
      .mockResolvedValue(progress(CaptureState.CAPTURE_STATE_DONE));
    vi.mocked(getCapture).mockResolvedValue({
      state: CaptureState.CAPTURE_STATE_DONE,
      report: { taskId: "t1", status: CaptureStatus.CAPTURE_STATUS_SUCCESS },
    } as never);

    expect((await waitForCapture("t1", undefined, [], options))?.taskId).toBe("t1");
  });

  it("PENDING のまま動かないときは、なぜ動かないかを訊いてから諦める", async () => {
    // PENDING に worstCaseRemainingMs は付かない。時間で切るしかないが、
    // 「混んでいる」と「誰も取りに来ない」は待っても解決するかが違う。
    vi.mocked(getCaptureProgress).mockResolvedValue(
      progress(CaptureState.CAPTURE_STATE_PENDING, { queuePosition: 3 }),
    );
    vi.mocked(getServerStatus).mockResolvedValue({
      operationalWorkers: 0,
      totalWorkers: 3,
      isDegraded: true,
      pending: 4,
    } as never);

    const report = await waitForCapture("t1", undefined, [], options);

    expect(report).toBeUndefined();
    expect(vi.mocked(getServerStatus)).toHaveBeenCalledTimes(1);
  });

  it("運用側の上限を渡せば、server の宣言より先に切れる", async () => {
    vi.mocked(getCaptureProgress).mockResolvedValue(
      progress(CaptureState.CAPTURE_STATE_PROCESSING, { worstCaseRemainingMs: 600_000 }),
    );

    const report = await waitForCapture("t1", undefined, [], { ...options, timeoutMs: 20 });

    expect(report).toBeUndefined();
    // server はまだ「あと 10 分」と言っている。切ったのはこちらの都合なので、
    // server 側の異常として数えてはいけない。
    expect(vi.mocked(getServerStatus)).not.toHaveBeenCalled();
  });
});
