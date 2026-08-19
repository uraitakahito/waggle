import { describe, expect, it } from "vitest";
import { readManifest } from "../src/archive/manifest.js";
import { CaptureStatus } from "../src/rpc/generated/browserhive/v1/capture.js";

/**
 * A `.result.json` exactly as BrowserHive v3 writes it: protobuf JSON, so the
 * enum is spelled with its full protobuf name. Hand-written rather than
 * produced by `toJSON`, which would only prove the generated pair agrees with
 * itself.
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
   * Manifests written before v3 spelled the status `"success"`. They decode to
   * UNRECOGNIZED, not to SUCCESS — so the reconciler skips them and says so,
   * rather than registering an archive on a value it did not understand.
   * Objects left in a bucket by a v2 server therefore stay unregistered; that
   * is the intended cost of the transport change, not an oversight.
   */
  it("does not mistake a pre-v3 status string for success", () => {
    const report = readManifest({ ...v3Manifest, status: "success" });

    expect(report.status).toBe(CaptureStatus.UNRECOGNIZED);
    expect(report.status).not.toBe(CaptureStatus.CAPTURE_STATUS_SUCCESS);
  });
});
