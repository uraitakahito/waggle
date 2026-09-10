import { describe, it, expect } from "vitest";
import type { S3Client } from "@aws-sdk/client-s3";
import type { Kysely } from "kysely";
import { narrowingFrom, reconcile } from "../src/archive/reconcile.js";
import type { Database } from "../src/db/database.js";

/**
 * reconcile の絞り込み。
 *
 * S3 の list は prefix でしか絞れないので、**何を prefix として要求したか**が
 * 絞れているかどうかのすべて。だからここは要求した prefix の集合を正面から見る ——
 * 「全走査していないこと」を `not.toHaveBeenCalledWith` で書くと、**1 度も list
 * しなくても通ってしまう**。
 */

/** bucket の中身。鍵ごとに、どの prefix の下に在るかで返り分ける。 */
const BUCKET: Record<string, string[]> = {
  "org/acme/2026-09/": ["org/acme/2026-09/550e8400-e29b-41d4-a716-446655440000__c1.result.json"],
  "org/acme/2026-08/": ["org/acme/2026-08/bbb__c2.result.json"],
  "org/globex/2026-09/": ["org/globex/2026-09/ccc__c3.result.json"],
  // 実物の bucket で踏んだ形。`_` で切った先頭が UUID にならない。
  "flat/": ["flat/not-a-uuid__c9.result.json"],
  "": [
    "org/acme/2026-09/550e8400-e29b-41d4-a716-446655440000__c1.result.json",
    "org/acme/2026-08/bbb__c2.result.json",
    "org/globex/2026-09/ccc__c3.result.json",
    "flat_ddd__c4.result.json",
    "not-a-manifest.wacz",
  ],
};

const fakeS3 = (): { s3: S3Client; requested: (string | undefined)[] } => {
  const requested: (string | undefined)[] = [];
  const send = (command: { input: { Prefix?: string } }): Promise<unknown> => {
    const prefix = command.input.Prefix;
    requested.push(prefix);
    return Promise.resolve({
      Contents: (BUCKET[prefix ?? ""] ?? []).map((Key) => ({ Key })),
    });
  };
  return { s3: { send } as unknown as S3Client, requested };
};

/**
 * `archives` に全部在ることにして、manifest を 1 つも GET させない最小の fake。
 * ここで見たいのは listing の絞り込みだけで、その先の登録は別の関心。
 */
const fakeDb = (
  knownTaskIds: readonly string[],
  tables: string[] = [],
): Kysely<Database> =>
  ({
    selectFrom: (table: string) => {
      tables.push(table);
      return {
        select: () => ({
          execute: () => Promise.resolve(knownTaskIds.map((taskId) => ({ taskId }))),
          where: () => ({ executeTakeFirst: () => Promise.resolve(undefined) }),
        }),
      };
    },
  }) as unknown as Kysely<Database>;

// 台帳に「既に在る」ことにする taskId。ここに在れば GET も引き当ても起きない。
const KNOWN = ["550e8400-e29b-41d4-a716-446655440000", "bbb", "ccc", "flat"];

describe("reconcile の絞り込み", () => {
  // 既定は変えていない。**掃除役が既定で取りこぼすようになってはいけない。**
  it("prefix を渡さなければ bucket 全体を 1 度歩く", async () => {
    const { s3, requested } = fakeS3();

    const result = await reconcile(fakeDb(KNOWN), s3, "archives");

    expect(requested).toEqual([undefined]);
    expect(result.manifests).toBe(4);
  });

  it("渡した prefix だけを歩く", async () => {
    const { s3, requested } = fakeS3();

    const result = await reconcile(fakeDb(KNOWN), s3, "archives", [
      "org/acme/2026-09/",
      "org/acme/2026-08/",
    ]);

    expect(requested).toEqual(["org/acme/2026-09/", "org/acme/2026-08/"]);
    // 平らな鍵も globex の鍵も見えない。**歩いていない場所は見えない**という
    // 当たり前が、絞り込みの代償そのもの。
    expect(result.manifests).toBe(2);
  });

  // prefix どうしが入れ子になれば同じ鍵が 2 度返る。数えるのは 1 度。
  it("入れ子の prefix でも鍵を重複して数えない", async () => {
    const { s3 } = fakeS3();

    const result = await reconcile(fakeDb(KNOWN), s3, "archives", [
      "",
      "org/acme/2026-09/",
    ]);

    expect(result.manifests).toBe(4);
  });

  // `.result.json` 以外は数えない。絞り込みを入れてもここは変わらない。
  it("manifest 以外の鍵は数えない", async () => {
    const { s3 } = fakeS3();

    const result = await reconcile(fakeDb(KNOWN), s3, "archives");

    expect(result.manifests).toBe(4); // not-a-manifest.wacz を含めれば 5
  });
});

describe("鍵の形を信用しない", () => {
  /**
   * `archives.task_id` も `capture_submissions.task_id` も uuid 列。UUID でない値で
   * 引くと Postgres が落ち、**その 1 件で走行が丸ごと止まる** —— 残りの manifest は
   * 歩かれないまま終わる。実物の bucket に置いた `flat_…` という鍵で踏んだ。
   *
   * 見るのは「飛ばした」ことではなく **`capture_submissions` を引かなかった**こと。
   * 数だけ見ると、引いてから落ちた実装でも通ってしまう。
   */
  it("UUID でない taskId は capture_submissions を引く前に飛ばす", async () => {
    const { s3 } = fakeS3();
    const tables: string[] = [];

    const result = await reconcile(fakeDb([], tables), s3, "archives", ["flat/"]);

    expect(tables).toEqual(["archives"]);
    expect(result.skipped).toBe(1);
    expect(result.unattributed).toBe(0);
  });

  // 形が合っていれば、これまでどおり引きに行く。**区別できる対**にしないと、
  // 「何も引かない」実装が上の 1 本で緑になる。
  it("UUID なら capture_submissions を引く", async () => {
    const { s3 } = fakeS3();
    const tables: string[] = [];

    await reconcile(fakeDb([], tables), s3, "archives", ["org/acme/2026-09/"]);

    expect(tables).toEqual(["archives", "captureSubmissions"]);
  });
});

describe("narrowingFrom", () => {
  it("全部記録が在れば、その集合を返す", () => {
    expect(
      narrowingFrom([
        { artifactKeyPrefix: "org/acme/2026-09/" },
        { artifactKeyPrefix: "org/acme/2026-08/" },
      ]),
    ).toEqual(["org/acme/2026-09/", "org/acme/2026-08/"]);
  });

  it("同じ月のクロールが何本あっても prefix は 1 つ", () => {
    expect(
      narrowingFrom([
        { artifactKeyPrefix: "org/acme/2026-09/" },
        { artifactKeyPrefix: "org/acme/2026-09/" },
        { artifactKeyPrefix: "org/acme/2026-09/" },
      ]),
    ).toEqual(["org/acme/2026-09/"]);
  });

  /**
   * **ここが要。** 記録の無い行が 1 本でも混じれば絞らない。
   *
   * その行の成果物がどこに在るかを言えないのに絞れば、その穴は二度と見つからない。
   * `archive/reconcile.ts` の冒頭が書いているとおり、気づかれない穴のある台帳は
   * 台帳が無いより悪い —— **取りこぼしを速さと交換しない。**
   */
  it("記録の無い行が 1 本でもあれば絞らない", () => {
    expect(
      narrowingFrom([
        { artifactKeyPrefix: "org/acme/2026-09/" },
        { artifactKeyPrefix: null },
        { artifactKeyPrefix: "org/acme/2026-08/" },
      ]),
    ).toBeUndefined();
  });

  // 窓に 1 本もクロールが無い。歩く先が無いので、絞った結果は空 ——
  // 「全部歩く」ではない。ここを undefined にすると、直近に何も走っていない
  // ときだけ全走査が起きるという、一番読めない振る舞いになる。
  it("窓が空なら空の集合を返す", () => {
    expect(narrowingFrom([])).toEqual([]);
  });
});
