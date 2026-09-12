import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 段の報告から台帳へ載せる経路。
 *
 * いちばん見たいのは **失敗の報告も一度は当たってみること**。BrowserHive の結果
 * キャッシュには上限があり、flow が 15 分待つ間に押し出されうる —— そのとき flow は
 * `NOT_FOUND` を受け取って `failed` と報告するが、取り込み自体は成功していて
 * 成果物は S3 に在る。ここで拾わないと、**まさに時間のかかった取り込みだけ**が
 * 台帳から落ち、しかもリンクが辿られずクロール木がそこで切れる。
 *
 * `getJsonObject` と `admitArchive` を偽物にしてある。この関数の仕事は「鍵を作り、
 * 無いものは飛ばし、入ったものを数えて名前を返す」という段取りのほうなので、
 * S3 と DB の本物は要らない。
 */
vi.mock("../src/archive/s3.js", () => ({ getJsonObject: vi.fn() }));
vi.mock("../src/archive/admit.js", () => ({ admitArchive: vi.fn() }));
// `readManifest` だけを偽物にする。**本物だと `undefined` を渡された時点で投げる**ので、
// 「飛ばした」と「投げて catch された」が同じ結果に見えてしまう (反証で素通りした)。
//
// **`manifestKey` は本物のまま。** 鍵の綴りは BrowserHive の命名規則と 1 文字でも
// ずれると静かに壊れる種類のもので、偽物に置き換えたら確かめる意味が無くなる。
vi.mock("../src/archive/manifest.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/archive/manifest.js")>()),
  readManifest: vi.fn((raw: unknown) => raw),
}));

const { getJsonObject } = await import("../src/archive/s3.js");
const { admitArchive } = await import("../src/archive/admit.js");
const { readManifest } = await import("../src/archive/manifest.js");
const { admitLevel } = await import("../src/crawl/admit-level.js");

/** BrowserHive が bucket に書くとおりの `.result.json`。 */
const manifest = (taskId: string) => ({
  taskId,
  url: "https://example.com/",
  labels: [],
  status: "CAPTURE_STATUS_SUCCESS",
  timestamp: "2026-08-30T00:00:00.000Z",
  captureProcessingTimeMs: 100,
  artifacts: { wacz: `s3://b/${taskId}.wacz` },
});

const options = {
  db: {} as never,
  s3: {} as never,
  bucket: "b",
  crawlId: "c1",
  orgId: "acme",
  requestedBy: "alice",
};

beforeEach(() => {
  vi.mocked(getJsonObject).mockReset();
  vi.mocked(admitArchive).mockReset();
  vi.mocked(readManifest).mockClear();
});

describe("台帳に載せる", () => {
  it("manifest が在れば載せ、その URL を返す", async () => {
    vi.mocked(getJsonObject).mockResolvedValue(manifest("t1"));
    vi.mocked(admitArchive).mockResolvedValue({ archiveId: 7 } as never);

    const result = await admitLevel([{ taskId: "t1", url: "https://example.com/a" }], options);

    expect(result.registered).toBe(1);
    expect(result.admittedUrls).toEqual(["https://example.com/a"]);
  });

  /**
   * **これが拾い直しの本体。**
   *
   * 呼ぶ側は報告が `failed` のページも渡してくる。`admitLevel` は状態を見ずに
   * manifest に当たり、成功していれば載せて名前を返す —— 呼ぶ側はそれを見て
   * `crawl_pages` の状態を上げる。
   */
  it("報告の状態を見ない（`failed` として渡されたものも載せる）", async () => {
    vi.mocked(getJsonObject).mockResolvedValue(manifest("t2"));
    vi.mocked(admitArchive).mockResolvedValue({ archiveId: 8 } as never);

    // 呼ぶ側が `failed` と判断したページ。`CapturedPage` に状態の欄は無い ——
    // 状態で絞るのは呼ぶ側の仕事ではない、という形にしてある。
    const result = await admitLevel([{ taskId: "t2", url: "https://example.com/b" }], options);

    expect(result.admittedUrls).toEqual(["https://example.com/b"]);
  });

  it("manifest がまだ無ければ飛ばす（reconcile が後で拾う）", async () => {
    // BrowserHive が書き終える前に段が閉じることはある。ここで投げると
    // 段の報告ごと 500 になって、クロールの進行が止まる。
    vi.mocked(getJsonObject).mockResolvedValue(undefined);

    const result = await admitLevel([{ taskId: "t3", url: "https://example.com/c" }], options);

    expect(result.registered).toBe(0);
    expect(result.admittedUrls).toEqual([]);
    // **`readManifest` に `undefined` を渡さないこと**が、この分岐の効き目。
    // 結果だけ見ると「投げて catch された」と区別が付かない。
    expect(readManifest).not.toHaveBeenCalled();
    expect(admitArchive).not.toHaveBeenCalled();
  });

  it("台帳が受け付けなかったものは返さない", async () => {
    // `admitArchive` は成功かつ wacz が在るときだけ行を作る。失敗した取り込みの
    // manifest は在るので、**manifest が在ること自体は成功の証拠にならない**。
    vi.mocked(getJsonObject).mockResolvedValue(manifest("t4"));
    vi.mocked(admitArchive).mockResolvedValue({ archiveId: undefined });

    const result = await admitLevel([{ taskId: "t4", url: "https://example.com/d" }], options);

    expect(result.registered).toBe(0);
    expect(result.admittedUrls).toEqual([]);
  });

  it("1 件が落ちても残りを進める", async () => {
    // 遅れて拾えるものは遅れてよい。台帳が遅れることよりクロールが止まるほうが重い。
    vi.mocked(getJsonObject)
      .mockRejectedValueOnce(new Error("S3 に届かない"))
      .mockResolvedValueOnce(manifest("t6"));
    vi.mocked(admitArchive).mockResolvedValue({ archiveId: 9 } as never);

    const result = await admitLevel(
      [
        { taskId: "t5", url: "https://example.com/e" },
        { taskId: "t6", url: "https://example.com/f" },
      ],
      options,
    );

    expect(result.admittedUrls).toEqual(["https://example.com/f"]);
  });

  it("correlationId が無ければ crawlId を鍵に使う", async () => {
    // クロールは `correlationId: <crawlId>` で投げている。報告に載っていなくても
    // 同じ鍵になるようにしてある —— ここがずれると manifest が永久に見つからない。
    vi.mocked(getJsonObject).mockResolvedValue(undefined);
    await admitLevel([{ taskId: "t7", url: "https://example.com/g" }], options);

    const key = vi.mocked(getJsonObject).mock.calls[0]?.[2];
    expect(key).toContain("t7");
    expect(key).toContain("c1");
  });
});
