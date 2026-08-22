/**
 * Regression test for the brand: a cast alone must not reach the send path.
 *
 * Nothing here is checked at runtime — the assertions are type-level, and the
 * checker is tsc. `@ts-expect-error` claims "this line must fail to compile",
 * so it flips to an error of its own the moment the protection stops working.
 * That property is the only thing that reports a defence coming undone at the
 * moment it comes undone.
 *
 * This file therefore only means something because `npm run typecheck` runs in
 * CI. Neither vitest nor eslint inspects `@ts-expect-error`.
 */
import { describe, expect, it } from "vitest";
import { submitCapture } from "../src/rpc/calls.js";
import { sealWire, type WireSubmitCapture } from "../src/rpc/wire.js";
import {
  CacheMode,
  type SubmitCaptureRequest,
} from "../src/rpc/generated/browserhive/v1/capture.js";

/** Stands in for the real send path, which accepts only branded requests. */
const send = (request: WireSubmitCapture): string => request.url;

const valid: SubmitCaptureRequest = {
  url: "https://example.com/",
  labels: [],
  cache: CacheMode.CACHE_MODE_UNSPECIFIED,
  devicePixelRatios: [],
};

/**
 * The real send path, not a stand-in.
 *
 * The stub below is convenient but proves nothing on its own: if
 * `submitCapture` were widened back to `SubmitCaptureRequest`, the stub would
 * keep passing while the actual gate was gone. A branded type is assignable to
 * its base, so nothing else would go red either. This line is what ties the
 * test to the thing being protected.
 */
// @ts-expect-error submitCapture accepts only a sealed request
const gatesTheRealSendPath: Parameters<typeof submitCapture>[0] = valid;
void gatesTheRealSendPath;

describe("wire brand", () => {
  it("accepts a request that went through sealWire", () => {
    expect(send(sealWire(valid))).toBe("https://example.com/");
  });

  it("rejects one that merely has the right shape", () => {
    // @ts-expect-error an unsealed SubmitCaptureRequest is not a WireSubmitCapture
    expect(() => send(valid)).not.toThrow();
  });

  it("rejects a two-step cast", () => {
    const plain: Record<string, unknown> = { url: "https://example.com/" };
    // The spelling that broke BrowserHive's e2e suite. The cast gets past the
    // type checker; the brand is what it cannot forge.
    // @ts-expect-error a two-step cast cannot satisfy WireSubmitCapture
    expect(() => send(plain as unknown as SubmitCaptureRequest)).not.toThrow();
  });
});
