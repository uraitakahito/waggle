/**
 * Reading BrowserHive's `.result.json` manifests.
 *
 * The manifest is the durable copy of a capture result, written to the bucket
 * next to the artifacts. Since BrowserHive v3 it is **protobuf JSON**: the
 * server serialises the same `CaptureResultReport` message it answers
 * `GetCapture` with, through the generated `toJSON`.
 *
 * That means enums are spelled as their protobuf names — `status` reads
 * `"CAPTURE_STATUS_SUCCESS"`, not `"success"` — and it is why nothing here
 * hand-parses the object. `fromJSON` is the generated inverse of the writer,
 * so the decoded report is identical in shape to one that came back over the
 * wire, and callers can compare against the `CaptureStatus` enum without
 * caring which of the two paths the report arrived by.
 */
import { CaptureResultReport } from "../rpc/generated/browserhive/v1/capture.js";

export const readManifest = (raw: unknown): CaptureResultReport =>
  CaptureResultReport.fromJSON(raw);
