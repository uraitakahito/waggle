import { describe, it, expect } from "vitest";
import { manifestKey } from "../src/archive/watch.js";

/**
 * BrowserHive の `generateFilename` (src/capture/page-capturer.ts) を写したもの:
 * 部分を `_` で繋ぎ、label は `-` で繋ぐ。順は taskId、correlationId、labels。
 *
 * waggle が server の応答から読むのではなく自分で組み立てる唯一の鍵なので、
 * 固定しておく価値がある。間違えても失うのは押し出されたときの代替経路だけ ——
 * reconciler のほうは listing で manifest を見つける —— だが、鍵が違えばその
 * 代替経路が黙って役に立たなくなる。
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
