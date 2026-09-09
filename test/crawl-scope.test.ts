import { describe, it, expect } from "vitest";
import { parseHttpUrl, inScope, acceptLinks } from "../src/crawl/scope.js";

/**
 * 範囲の判定と正規化。
 *
 * ここが緩いとクロールは範囲外へ出て、厳しすぎると同じページを何度も取る。どちらも
 * 「動いているように見える」ので、境目を 1 つずつ固定しておく。
 */
const seed = parseHttpUrl("https://example.com/start")!;

describe("URL の読み取りと正規化", () => {
  it("drops the fragment", () => {
    // `#section` は同じ資源の中の位置。落とさないと同じページを何度も取る。
    expect(parseHttpUrl("https://example.com/a#top")?.normalized).toBe("https://example.com/a");
  });

  it("keeps the query untouched", () => {
    // 並べ替えたクエリが別のページを返すサイトは実在する。取りこぼしより取り違えが悪い。
    const a = parseHttpUrl("https://example.com/a?b=2&a=1")?.normalized;
    expect(a).toBe("https://example.com/a?b=2&a=1");
  });

  it("refuses a scheme that is not http(s)", () => {
    for (const raw of ["mailto:a@example.com", "javascript:alert(1)", "tel:+81", "data:,x"]) {
      expect(parseHttpUrl(raw)).toBeUndefined();
    }
  });

  it("refuses something that is not a url at all", () => {
    expect(parseHttpUrl("/relative/path")).toBeUndefined();
    expect(parseHttpUrl("")).toBeUndefined();
  });
});

describe("範囲の判定", () => {
  it("treats a different scheme as a different origin", () => {
    // http と https は別 origin。混在するサイトでは same-host を選ぶことになる。
    const candidate = parseHttpUrl("http://example.com/a")!;
    expect(inScope(candidate, seed, "same-origin")).toBe(false);
    expect(inScope(candidate, seed, "same-host")).toBe(true);
  });

  it("treats a different port as a different origin", () => {
    const candidate = parseHttpUrl("https://example.com:8443/a")!;
    expect(inScope(candidate, seed, "same-origin")).toBe(false);
  });

  it("treats a subdomain as outside", () => {
    // `same-host` でも外。ホストが違えば別のサーバで、負荷の宛先も別。
    const candidate = parseHttpUrl("https://www.example.com/a")!;
    expect(inScope(candidate, seed, "same-origin")).toBe(false);
    expect(inScope(candidate, seed, "same-host")).toBe(false);
  });

  it("accepts the same origin on a different path", () => {
    expect(inScope(parseHttpUrl("https://example.com/deep/a")!, seed, "same-origin")).toBe(true);
  });
});

describe("辿るリンクの選び方", () => {
  it("keeps only what is in scope", () => {
    const accepted = acceptLinks(
      [
        { href: "https://example.com/a" },
        { href: "https://other.com/b" },
        { href: "mailto:a@example.com" },
      ],
      seed,
      "same-origin",
    );
    expect(accepted.map((a) => a.url)).toEqual(["https://example.com/a"]);
  });

  it("refuses a rel that contains nofollow as a word", () => {
    const accepted = acceptLinks(
      [
        { href: "https://example.com/a", rel: "nofollow" },
        { href: "https://example.com/b", rel: "noopener nofollow" },
      ],
      seed,
      "same-origin",
    );
    expect(accepted).toEqual([]);
  });

  it("does not mistake a longer word for nofollow", () => {
    // 部分一致で書くとこれが落ちる。`rel` は空白区切りの語の並び。
    const accepted = acceptLinks(
      [{ href: "https://example.com/a", rel: "nofollowme" }],
      seed,
      "same-origin",
    );
    expect(accepted.map((a) => a.url)).toEqual(["https://example.com/a"]);
  });

  it("collapses links that differ only by fragment", () => {
    const accepted = acceptLinks(
      [{ href: "https://example.com/a" }, { href: "https://example.com/a#x" }],
      seed,
      "same-origin",
    );
    expect(accepted).toHaveLength(1);
  });

  it("carries the host so the caller does not have to parse again", () => {
    const accepted = acceptLinks([{ href: "https://example.com/a" }], seed, "same-origin");
    expect(accepted[0]?.host).toBe("example.com");
  });

  it("tolerates a null rel", () => {
    // BrowserHive は rel が無いとき null を入れてくる。
    const accepted = acceptLinks(
      [{ href: "https://example.com/a", rel: null }],
      seed,
      "same-origin",
    );
    expect(accepted).toHaveLength(1);
  });
});
