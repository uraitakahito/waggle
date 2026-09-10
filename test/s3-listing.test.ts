import { describe, it, expect, vi } from "vitest";
import type { S3Client } from "@aws-sdk/client-s3";
import { listAllKeys } from "../src/archive/s3.js";

/**
 * `listAllKeys` の試験。**これまで 1 本も無かった**。
 *
 * reconciler の入口で、成果物を見つける唯一の経路なのに覆われていなかった。
 * 覆われていなかったせいで、`EncodingType` を渡していないことに誰も気づけなかった。
 *
 * ListObjectsV2 の応答は **XML** で、XML 1.0 は ASCII 0-8 などを表せない。AWS の
 * 文書がそのために `encoding-type` を用意している。付けないと、制御文字を含む鍵は
 * **オブジェクトが在るのに一覧に出てこない**。BrowserHive 側で制御文字を逃がすように
 * したので今後そういう鍵は作られないが、**既に置かれたもの**と、BrowserHive 以外が
 * 置いたものが残る。listing の側でも守る。
 *
 * SDK v3 は復号してくれない (Ruby SDK と違い自動復号の plugin が無い) ので、
 * 送る側と受ける側の**両方**を固定する。片方だけ直すと鍵が壊れて返る。
 *
 * https://docs.aws.amazon.com/AmazonS3/latest/API/API_ListObjectsV2.html
 */
const fakeS3 = (
  pages: { Contents?: { Key?: string }[]; IsTruncated?: boolean; NextContinuationToken?: string }[],
): { s3: S3Client; send: ReturnType<typeof vi.fn> } => {
  let call = 0;
  const send = vi.fn(() => Promise.resolve(pages[call++] ?? {}));
  return { s3: { send } as unknown as S3Client, send };
};

describe("listAllKeys", () => {
  it("EncodingType: url を付けて一覧する", async () => {
    const { s3, send } = fakeS3([{ Contents: [{ Key: "a.wacz" }] }]);

    await listAllKeys(s3, "archives");

    const command = send.mock.calls[0]?.[0] as { input: Record<string, unknown> } | undefined;
    expect(command?.input["EncodingType"]).toBe("url");
  });

  /**
   * S3 の list は **prefix でしか絞れない**ので、絞り込みはここを通るしかない。
   *
   * 実物 (SeaweedFS) に投げて、`EncodingType: "url"` と同時に効くことと、鍵が正しく
   * 復号されて返ることを確かめてある —— 掛かるのは応答に echo される側で、送る
   * `Prefix` は生のままでよい。ここではその綴りが input に届くことを見る。
   */
  it("prefix を渡すと Prefix として送る", async () => {
    const { s3, send } = fakeS3([{ Contents: [{ Key: "org/acme/2026-09/a.wacz" }] }]);

    await listAllKeys(s3, "archives", "org/acme/2026-09/");

    const command = send.mock.calls[0]?.[0] as { input: Record<string, unknown> } | undefined;
    expect(command?.input["Prefix"]).toBe("org/acme/2026-09/");
    // 符号化して渡さないこと。したら `org%2Facme%2F…` という鍵を探して 0 件になる。
    expect(command?.input["EncodingType"]).toBe("url");
  });

  // 既定は bucket 全体。**渡さなければ付かない**ことを見ないと、常に空文字を送る
  // 実装が緑で通る。
  it("prefix を渡さなければ Prefix を送らない", async () => {
    const { s3, send } = fakeS3([{ Contents: [{ Key: "a.wacz" }] }]);

    await listAllKeys(s3, "archives");

    const command = send.mock.calls[0]?.[0] as { input: Record<string, unknown> } | undefined;
    expect(command?.input["Prefix"]).toBeUndefined();
  });

  // ページ送りの 2 ページ目以降にも付き続けること。落ちると 2 ページ目から **bucket
  // 全体が混ざる** —— しかも 1 ページで収まる規模では誰も気づけない。
  it("ページ送りしても Prefix を持ち続ける", async () => {
    const { s3, send } = fakeS3([
      {
        Contents: [{ Key: "org/acme/2026-09/a.wacz" }],
        IsTruncated: true,
        NextContinuationToken: "t1",
      },
      { Contents: [{ Key: "org/acme/2026-09/b.wacz" }] },
    ]);

    await listAllKeys(s3, "archives", "org/acme/2026-09/");

    const second = send.mock.calls[1]?.[0] as { input: Record<string, unknown> } | undefined;
    expect(second?.input["Prefix"]).toBe("org/acme/2026-09/");
    expect(second?.input["ContinuationToken"]).toBe("t1");
  });

  /**
   * `encoding-type=url` を付けた以上、返る鍵は percent-encoded。復号しないと
   * `"a%01b.result.json"` のような鍵をそのまま台帳に載せてしまい、
   * BrowserHive が組む名前と突き合わせられなくなる。
   */
  it("URL 符号化された鍵を復号して返す", async () => {
    const { s3 } = fakeS3([
      {
        Contents: [
          { Key: "task_corr_a%01b.result.json" },
          { Key: "%E3%83%A4%E3%83%95%E3%83%BC.wacz" },
        ],
      },
    ]);

    const keys = await listAllKeys(s3, "archives");

    expect(keys).toEqual(["task_corr_a\u0001b.result.json", "ヤフー.wacz"]);
  });

  /** ページ送りも辿ること。既存の挙動で、上の 2 本の巻き添えで壊さないため。 */
  it("ページ送りを辿る", async () => {
    const { s3 } = fakeS3([
      { Contents: [{ Key: "a.wacz" }], IsTruncated: true, NextContinuationToken: "t1" },
      { Contents: [{ Key: "b.wacz" }] },
    ]);

    expect(await listAllKeys(s3, "archives")).toEqual(["a.wacz", "b.wacz"]);
  });
});
