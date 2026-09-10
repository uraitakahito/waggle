import { describe, it, expect } from "vitest";
import { crawlKeyPrefix, keyPrefixFor, sinkObjectKey } from "../src/api/sink.js";
import { manifestKey } from "../src/archive/manifest.js";

/**
 * 成果物の置き場所を決める 2 つの純関数。
 *
 * ここが守るのは速さではなく **一致** —— 置く側 (受け口) と探す側 (`admitLevel`) が
 * 別々に接頭辞を計算すると、月をまたいだクロールや受け口の設定を切り替えた配備で
 * ずれる。ずれると `archive/manifest.ts` が書いているとおり **manifest が見つからず、
 * 台帳に 1 行も入らないまま静かに終わる**。だから両側が `crawls.artifact_key_prefix`
 * という 1 か所を読む形にしてあり、その綴りを決めるのがこの 2 つ。
 */
const SINK = { origin: "https://waggle.example", secret: "s" };

describe("crawlKeyPrefix", () => {
  it("組織と月で分け、末尾に / を付ける", () => {
    expect(crawlKeyPrefix("acme", new Date("2026-09-10T12:00:00Z"))).toBe("org/acme/2026-09/");
  });

  // 月は 0 埋め。しないと `2026-9` と `2026-09` が混ざり、prefix で絞ったときに
  // 片方だけが返る。
  it("1 桁の月を 0 埋めする", () => {
    expect(crawlKeyPrefix("acme", new Date("2026-01-31T00:00:00Z"))).toBe("org/acme/2026-01/");
  });

  /**
   * **UTC で切る。** ここが実行環境のローカル時刻に依存すると、置いた側と探す側が
   * 別の TZ で動いた瞬間に 1 か月ずれる —— この設計がまさに塞ごうとしているずれを、
   * 別の形で作り直すことになる。
   *
   * 下の 2 つは JST (UTC+9) では 2027 年 1 月に入る時刻。ローカル時刻で切る実装だと
   * `org/acme/2027-01/` になるので、**区別できる入力**になっている。
   */
  it("ローカル時刻ではなく UTC で月を決める", () => {
    expect(crawlKeyPrefix("acme", new Date("2026-12-31T23:00:00Z"))).toBe("org/acme/2026-12/");
    expect(crawlKeyPrefix("acme", new Date("2026-12-31T15:00:00Z"))).toBe("org/acme/2026-12/");
  });
});

describe("keyPrefixFor", () => {
  // 記録が在れば、いまの設定が何であれそれを読む。**そのクロールが実際に置いた
  // 場所**が答えなので、設定の側が勝つ余地は無い。
  it("記録された接頭辞をそのまま返す", () => {
    expect(keyPrefixFor({ orgId: "acme", artifactKeyPrefix: "org/acme/2026-01/" }, SINK)).toBe(
      "org/acme/2026-01/",
    );
  });

  // 受け口を切ってから同じクロールの続きを報告しても、探し先は変わらない。
  // ここが設定を見る実装だと undefined になり、manifest が見つからなくなる。
  it("受け口が無くても、記録が在ればそれを読む", () => {
    expect(keyPrefixFor({ orgId: "acme", artifactKeyPrefix: "org/acme/2026-01/" }, undefined)).toBe(
      "org/acme/2026-01/",
    );
  });

  // `013` より前に作られた行。従来どおり設定から導く —— 過去の行の振る舞いを
  // 変えないため。
  it("記録が無ければ設定から導く", () => {
    expect(keyPrefixFor({ orgId: "acme", artifactKeyPrefix: null }, SINK)).toBe("org/acme/");
    expect(keyPrefixFor({ orgId: "acme", artifactKeyPrefix: null }, undefined)).toBeUndefined();
  });
});

describe("置く側と探す側の一致", () => {
  /**
   * **これが要。** 受け口が書く鍵と、`admitLevel` が組み立てて GET する鍵が、
   * 同じ綴りになること。
   *
   * 月を **いまと違う月** にしてあるのが肝で、`orgId` から組み直す実装だと
   * ここが赤くなる —— 同じ月のうちは記録から読んでも組み直しても同じ綴りになるので、
   * 区別できる入力を置かないと検査が素通りする。
   */
  it("受け口が書く鍵と、探す側が組み立てる鍵が一致する", () => {
    const crawl = { orgId: "acme", artifactKeyPrefix: "org/acme/2026-01/" };
    const taskId = "550e8400-e29b-41d4-a716-446655440000";
    const correlationId = "9f1c0b2a";

    // 受け口が書く側 (`api/sink.ts` の PUT ハンドラと同じ組み立て)
    const written =
      (crawl.artifactKeyPrefix ?? sinkObjectKey(crawl.orgId, "")) +
      `${taskId}_${correlationId}.result.json`;

    // 探す側 (`crawl/admit-level.ts`)
    const sought = manifestKey(taskId, correlationId, [], keyPrefixFor(crawl, SINK));

    expect(sought).toBe(written);
    expect(sought).toBe(
      "org/acme/2026-01/550e8400-e29b-41d4-a716-446655440000_9f1c0b2a.result.json",
    );
  });
});
