import { describe, it, expect } from "vitest";
import { manifestKey } from "../src/archive/watch.js";

/**
 * Mirrors BrowserHive's `generateFilename` (src/capture/page-capturer.ts):
 * parts joined by `_`, labels joined by `-`, in the order
 * taskId, correlationId, labels.
 *
 * This is the one key waggle reconstructs instead of reading it from a
 * server response, so it is worth pinning. Getting it wrong only costs the
 * eviction fallback — the reconciler finds manifests by listing — but a wrong
 * key would make that fallback silently useless.
 */
describe("manifestKey", () => {
  const TASK = "550e8400-e29b-41d4-a716-446655440000";

  it("includes correlationId and labels when both are present", () => {
    expect(manifestKey(TASK, "abc123de", ["smoke"])).toBe(`${TASK}_abc123de_smoke.result.json`);
  });

  it("joins multiple labels with a dash", () => {
    expect(manifestKey(TASK, "abc123de", ["9202", "ANAHoldings"])).toBe(
      `${TASK}_abc123de_9202-ANAHoldings.result.json`,
    );
  });

  it("omits labels when there are none", () => {
    expect(manifestKey(TASK, "abc123de", [])).toBe(`${TASK}_abc123de.result.json`);
  });

  it("omits correlationId when absent", () => {
    expect(manifestKey(TASK, undefined, ["smoke"])).toBe(`${TASK}_smoke.result.json`);
  });

  it("treats an empty correlationId as absent", () => {
    expect(manifestKey(TASK, "", ["smoke"])).toBe(`${TASK}_smoke.result.json`);
  });

  it("uses the bare taskId when neither is present", () => {
    expect(manifestKey(TASK, undefined, [])).toBe(`${TASK}.result.json`);
  });
});
