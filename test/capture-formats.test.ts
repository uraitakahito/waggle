import { describe, it, expect } from "vitest";
import { parseCaptureFormats, withLinks } from "../src/config/capture-formats.js";

/**
 * 取り込む形式の設定。**起動時に解釈する唯一の場所。**
 *
 * 実行のたびに解釈すると、綴りの誤りは夜中の定期実行が失敗して初めて見つかる ——
 * しかも server が返すのは「形式が 1 つも無い」で、env の値には一言も触れない。
 */

const on = (settings: { formats: Record<string, boolean> }): string[] =>
  Object.entries(settings.formats)
    .filter(([, v]) => v)
    .map(([k]) => k)
    .sort();

describe("形式の設定を読む", () => {
  it("コンマ区切りを 6 つの真偽値にする", () => {
    // **6 つ全部を明示して返す。** 未設定と false は proto3 では別物で、
    // 落とすと「指定なし」として届く。
    expect(parseCaptureFormats("wacz,png", false).formats).toEqual({
      png: true,
      webp: false,
      html: false,
      links: false,
      mhtml: false,
      wacz: true,
    });
  });

  it("空白と大小文字を吸収する", () => {
    expect(on(parseCaptureFormats(" WACZ , Html ", false))).toEqual(["html", "wacz"]);
  });

  it("綴りの誤りを黙って落とさず、名指しする", () => {
    expect(() => parseCaptureFormats("waxz", false)).toThrow(/waxz/);
  });

  it("空の設定を拒む", () => {
    expect(() => parseCaptureFormats("", false)).toThrow(/empty/);
  });

  it("wacz 抜きの署名を拒む", () => {
    // 署名は WACZ を覆うもの。CLI では parseClientOptions が同じことを言うが、
    // HTTP 経路はそこを通らないので、ここが唯一この検査の在る場所。
    expect(() => parseCaptureFormats("png", true)).toThrow(/wacz/);
  });

  it("wacz があれば署名を通す", () => {
    expect(parseCaptureFormats("wacz", true).signing).toBe(true);
  });
});

describe("辿るなら links を足す", () => {
  it("深さがあるときは設定に無くても links を立てる", () => {
    // **無いと 1 段目で必ず止まり、しかも「リンクが 1 本も無かった」に見える。**
    // 設定の誤りが「そういうサイトだった」と区別が付かなくなる。
    const { formats } = parseCaptureFormats("wacz", false);
    expect(withLinks(formats, true).links).toBe(true);
  });

  it("辿らないときは足さない", () => {
    // 対象一覧をまとめて取るだけの経路。取り出させても相手と S3 に無駄が出る。
    const { formats } = parseCaptureFormats("wacz", false);
    expect(withLinks(formats, false).links).toBe(false);
  });

  it("辿らなくても、設定で選ばれていれば残す", () => {
    const { formats } = parseCaptureFormats("wacz,links", false);
    expect(withLinks(formats, false).links).toBe(true);
  });
});
