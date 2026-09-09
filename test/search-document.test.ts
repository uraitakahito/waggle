import { describe, it, expect } from "vitest";
import { parsePagesJsonl, searchDocument, type ArchiveRow } from "../src/search/document.js";

/**
 * 索引に載せる 1 件を組む部分。**ここだけが「何を索引するか」を決めている**ので、
 * OpenSearch も S3 も立てずにここで押さえる。
 *
 * 本物の `pages.jsonl` から採った行を使う (meadow の `/responsive-images` を
 * 取り込んだ WACZ)。作り物だと、ヘッダ行の存在そのものを忘れて書ける。
 */

/** 実物の WACZ から採ったヘッダ行。 */
const HEADER = '{"format": "json-pages-1.0", "id": "pages", "title": "All Pages"}';

const PAGE =
  '{"id": "09791c9f-264b-40ee-8a40-40dc0362f6e6", "url": "http://meadow.browserhive:8080/responsive-images", "ts": "2026-09-07T22:06:40.697Z", "title": "responsive", "text": "responsive\\n  image"}';

const ARCHIVE: ArchiveRow = {
  id: "11111111-1111-1111-1111-111111111111",
  objectKey: "09791c9f__e2e.wacz",
  sourceUrl: "http://meadow.browserhive:8080/responsive-images",
  labels: [],
  capturedAt: new Date("2026-09-07T22:06:40.697Z"),
};

describe("pages.jsonl の解析", () => {
  it("ヘッダ行を落とす", () => {
    // **これが肝。** 1 行目はページではない。載せると「All Pages」という題の
    // ドキュメントが検索に出る —— しかも URL を持たないので、開くこともできない。
    const pages = parsePagesJsonl(`${HEADER}\n${PAGE}\n`);
    expect(pages).toHaveLength(1);
    expect(pages[0]!.url).toBe("http://meadow.browserhive:8080/responsive-images");
  });

  it("url を持たない行はページとして扱わない", () => {
    // 見分けているのは `format` の有無ではなく `url` の有無。形式の版が上がっても
    // 判定が壊れないようにしてある。
    expect(parsePagesJsonl('{"id": "x", "title": "t"}\n')).toHaveLength(0);
    expect(parsePagesJsonl('{"url": "", "title": "t"}\n')).toHaveLength(0);
  });

  it("壊れた行を飛ばして残りを読む", () => {
    // 1 行の破損で WACZ 1 本ぶんを落とさない。
    const pages = parsePagesJsonl(`${HEADER}\n{壊れている\n${PAGE}\n`);
    expect(pages).toHaveLength(1);
  });

  it("空行だけなら 0 件", () => {
    expect(parsePagesJsonl("\n\n  \n")).toEqual([]);
  });
});

describe("索引に載せる 1 件", () => {
  const page = parsePagesJsonl(PAGE)[0]!;

  it("本文と題を運ぶ", () => {
    const doc = searchDocument(page, ARCHIVE);
    expect(doc.title).toBe("responsive");
    expect(doc.text).toContain("image");
    expect(doc.archiveId).toBe(ARCHIVE.id);
    expect(doc.objectKey).toBe(ARCHIVE.objectKey);
  });

  it("本文を出さなかった理由を運ぶ", () => {
    // **「本文が無い」と「本文を出さなかった」を潰さない。** 落とすと、取り込みが
    // 空だったのと、方針が保存を禁じたのが同じ見た目になる。前者は調べるべき異常。
    const withheld = { url: "http://x/", textWithheld: "url-policy" };
    expect(searchDocument(withheld, ARCHIVE).textWithheld).toBe("url-policy");
    expect(searchDocument(withheld, ARCHIVE).text).toBe("");

    // 落としていないほうは null。undefined にしないのは、OpenSearch 側で
    // 「field が無い」と区別が付かなくなるため。
    expect(searchDocument(page, ARCHIVE).textWithheld).toBeNull();
  });

  it("本文が切り詰められた申告を運ぶ", () => {
    // 100 万文字で切られた本文を「全文」として載せると、「その語はこのページに
    // 無い」と言えなくなる。
    const truncated = { url: "http://x/", text: "a", textTruncated: true };
    expect(searchDocument(truncated, ARCHIVE).textTruncated).toBe(true);
    expect(searchDocument(page, ARCHIVE).textTruncated).toBe(false);
  });

  it("題も本文も無ければ空文字にする", () => {
    const doc = searchDocument({ url: "http://x/" }, ARCHIVE);
    expect(doc.title).toBe("");
    expect(doc.text).toBe("");
  });
});
