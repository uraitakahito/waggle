import { describe, it, expect } from "vitest";
import { manifestKey } from "../src/archive/manifest.js";
import { sinkObjectKey } from "../src/api/sink.js";

/**
 * BrowserHive の `generateFilename` (src/capture/artifact-name.ts) を写したもの:
 * `{taskId}_{correlationId}[_{labels}].result.json`。**correlationId の枠は空でも出る**。
 * 値の中の `_` `.` `/` 空白などは `%XX` へ逃がす。
 *
 * ledger が server の応答から読むのではなく自分で組み立てる唯一の鍵なので、
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

  /**
   * 鍵に制御文字が残らないこと。
   *
   * **この 1 本だけは写しではない。** 上の一連は BrowserHive と同じケースを
   * 並べて突き合わせているが、それが捕まえるのは「ずれ」だけで、両方が同じ穴を
   * 持っていれば緑のままになる。実際そうだった —— どちらの `ESCAPED` にも
   * 制御文字が入っておらず、11 本すべてが緑のまま素通ししていた。
   *
   * だからこれは ledger 側で **独立に成り立つべき性質** として置く。鍵は
   * ListObjectsV2 の XML で返り、XML 1.0 は ASCII 0-8 などを表せないので、
   * 制御文字が残ると reconciler が成果物を見つけられなくなる。
   */
  it("鍵に制御文字が残らない", () => {
    expect(manifestKey(TASK, undefined, ["a\u0001b"])).not.toMatch(/\p{Cc}/u);
    expect(manifestKey(TASK, "a\u007Fb", [])).not.toMatch(/\p{Cc}/u);
  });
});

/**
 * **置く側と探す側が一致していること。**
 *
 * 受け口は `org/<orgId>/<filename>` へ置き、台帳は `manifestKey(..., keyPrefix)` で
 * 探す。片方だけ変えると manifest が見つからず、**台帳に 1 行も入らないまま
 * 「成功」で終わる** —— 取り込みは動いているので、気づく手がかりが無い。
 */
describe("受け口の置き場所と manifest の鍵", () => {
  const TASK = "00000000-0000-4000-8000-000000000001";
  it("同じ場所を指す", () => {
    const filename = `${TASK}_abc123de.result.json`;

    // 置く側
    const written = sinkObjectKey("acme", filename);
    // 探す側
    const looked = manifestKey(TASK, "abc123de", [], sinkObjectKey("acme", ""));

    expect(looked).toBe(written);
    expect(looked).toBe(`org/acme/${TASK}_abc123de.result.json`);
  });

  it("接頭辞が無ければ従来どおり平ら", () => {
    expect(manifestKey(TASK, "abc123de", [])).toBe(`${TASK}_abc123de.result.json`);
  });
});
