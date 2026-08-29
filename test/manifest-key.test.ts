import { describe, it, expect } from "vitest";
import { manifestKey } from "../src/archive/watch.js";

/**
 * BrowserHive の `generateFilename` (src/capture/artifact-name.ts) を写したもの:
 * `{taskId}_{correlationId}[_{labels}].result.json`。**correlationId の枠は空でも出る**。
 * 値の中の `_` `.` `/` 空白などは `%XX` へ逃がす。
 *
 * waggle が server の応答から読むのではなく自分で組み立てる唯一の鍵なので、
 * 固定しておく価値がある。**間違えても静かに壊れる** —— 失うのは押し出された
 * ときの代替経路だけで、reconciler のほうは listing で manifest を見つけるため、
 * ログにも結果にも異常が出ない。
 *
 * ケースは向こうの test/capture/artifact-name.test.ts と揃えてある。特に
 * 「correlationId だけ」と「label だけ」が **別の鍵になる** こと、
 * `["a","b"]` と `["a-b"]` が **別の鍵になる** こと —— どちらも以前は同じ鍵だった。
 */
describe("manifestKey", () => {
  const TASK = "550e8400-e29b-41d4-a716-446655440000";

  it("両方あるとき", () => {
    expect(manifestKey(TASK, "abc123de", ["smoke"])).toBe(`${TASK}_abc123de_smoke.result.json`);
  });

  it("label が複数のとき、1 つずつ枠を取る", () => {
    expect(manifestKey(TASK, "abc123de", ["9202", "ANAHoldings"])).toBe(
      `${TASK}_abc123de_9202_ANAHoldings.result.json`,
    );
  });

  it("label が無いとき", () => {
    expect(manifestKey(TASK, "abc123de", [])).toBe(`${TASK}_abc123de.result.json`);
  });

  it("correlationId が無くても枠は残る", () => {
    expect(manifestKey(TASK, undefined, ["smoke"])).toBe(`${TASK}__smoke.result.json`);
  });

  it("空の correlationId は無いのと同じ", () => {
    expect(manifestKey(TASK, "", ["smoke"])).toBe(`${TASK}__smoke.result.json`);
  });

  it("どちらも無いとき、末尾に空の枠が 1 つ残る", () => {
    expect(manifestKey(TASK, undefined, [])).toBe(`${TASK}_.result.json`);
  });

  /**
   * 以前はこの 2 つが同じ鍵になっていた。correlationId が 1 つだけ在るときと
   * label が 1 つだけ在るときの区別がつかなかったため。
   */
  it("correlationId だけと label だけは別の鍵になる", () => {
    expect(manifestKey(TASK, "e2e", [])).not.toBe(manifestKey(TASK, undefined, ["e2e"]));
  });

  /** 以前は label を "-" で繋いでいたので、この 2 つも同じ鍵になっていた。 */
  it('["a","b"] と ["a-b"] は別の鍵になる', () => {
    expect(manifestKey(TASK, undefined, ["a", "b"])).not.toBe(
      manifestKey(TASK, undefined, ["a-b"]),
    );
  });

  it("区切りとぶつかる文字は逃がす", () => {
    expect(manifestKey(TASK, undefined, ["a_b"])).toBe(`${TASK}__a%5Fb.result.json`);
    expect(manifestKey(TASK, undefined, ["hello world"])).toBe(
      `${TASK}__hello%20world.result.json`,
    );
  });

  /** 非 ASCII は逃がす対象に無い。鍵の中でも読めるままにするため。 */
  it("日本語はそのまま残る", () => {
    expect(manifestKey(TASK, undefined, ["ヤフー"])).toBe(`${TASK}__ヤフー.result.json`);
  });
});
