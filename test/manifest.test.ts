import { describe, expect, it } from "vitest";
import { readManifest } from "../src/archive/manifest.js";
import { CaptureStatus } from "../src/rpc/generated/browserhive/v1/capture.js";

/**
 * BrowserHive v3 が書くとおりの `.result.json`: protobuf JSON なので、enum は
 * protobuf の完全な名前で綴られる。`toJSON` で作らず手で書いている —— 生成された
 * 対が自分自身と一致することしか証明しないので。
 */
const v3Manifest = {
  taskId: "01J8Z0",
  correlationId: "ab12cd34",
  url: "https://example.com/",
  labels: ["news"],
  status: "CAPTURE_STATUS_SUCCESS",
  timestamp: "2026-08-19T00:00:00.000Z",
  captureProcessingTimeMs: 4210,
  retryCount: 0,
  workerIndex: 1,
  artifacts: { wacz: "s3://archives/01J8Z0.wacz" },
  completeness: { complete: true },
};

describe("readManifest", () => {
  it("decodes the protobuf-JSON manifest BrowserHive writes", () => {
    const report = readManifest(v3Manifest);

    expect(report.status).toBe(CaptureStatus.CAPTURE_STATUS_SUCCESS);
    expect(report.taskId).toBe("01J8Z0");
    expect(report.artifacts?.wacz).toBe("s3://archives/01J8Z0.wacz");
    expect(report.completeness?.complete).toBe(true);
    expect(report.labels).toEqual(["news"]);
  });

  /**
   * v3 より前に書かれた manifest は status を `"success"` と綴っていた。それらは
   * SUCCESS ではなく UNRECOGNIZED に復号される —— なので reconciler は、理解できて
   * いない値の上にアーカイブを登録するのではなく、飛ばしてそう言う。v2 の server が
   * bucket に残したオブジェクトは登録されないままになる。それは転送方式を変えた
   * ことの意図した代償であって、見落としではない。
   */
  it("does not mistake a pre-v3 status string for success", () => {
    const report = readManifest({ ...v3Manifest, status: "success" });

    expect(report.status).toBe(CaptureStatus.UNRECOGNIZED);
    expect(report.status).not.toBe(CaptureStatus.CAPTURE_STATUS_SUCCESS);
  });
});
