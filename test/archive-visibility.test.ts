import { describe, it, expect } from "vitest";
import type { OpenFgaClient } from "@openfga/sdk";
import { mayViewArchive, viewableArchiveIds } from "../src/api/archive-visibility.js";

/**
 * 「このアーカイブを見てよいか」を訊く 1 か所。
 *
 * `GET /api/archives` と `GET /api/search` が同じものを使うので、**片方の route の
 * 試験だけでは守れない**。あちらの試験は route の返り値を見ているが、こちらは
 * **fga に何を訊いたか**を見る —— 所属の申告を渡し忘れても、偽の fga は
 * 「許す」と答え続けるので route 側は緑のままになる。
 *
 * fga が「誰を拒むか」はここでは見ていない。それは `fga/model.fga.yaml` の
 * assertion の仕事。
 */

const ALICE = { subject: "alice", organizations: ["acme", "beta"] };

/** 訊かれた内容を記録し、指定した id だけ許す偽の fga。 */
const recordingFga = (allowedIds: string[]) => {
  const batches: unknown[] = [];
  const singles: unknown[] = [];
  const fga = {
    batchCheck: (req: { checks: { object: string }[] }) => {
      batches.push(req);
      return Promise.resolve({
        result: req.checks.map((c) => ({
          allowed: allowedIds.some((id) => c.object === `archive:${id}`),
          request: { object: c.object },
        })),
      });
    },
    check: (body: { object: string }, opts: unknown) => {
      singles.push({ body, opts });
      return Promise.resolve({
        allowed: allowedIds.some((id) => body.object === `archive:${id}`),
      });
    },
  } as unknown as OpenFgaClient;
  return { fga, batches, singles };
};

describe("見てよいものを絞る", () => {
  it("許された id だけを、接頭辞なしで返す", async () => {
    // 呼ぶ側が `archive:` を組み立てなくてよいようにしてある。接頭辞の組み立てが
    // 2 か所にあると、片方だけ綴りを間違えても気づけない。
    const { fga } = recordingFga(["a"]);
    await expect(viewableArchiveIds(fga, ALICE, ["a", "b", "c"])).resolves.toEqual(new Set(["a"]));
  });

  it("所属を contextual tuple として渡す", async () => {
    // **これが肝。** 渡し忘れても偽の fga は答えを変えないので、route の試験は
    // 緑のままになる。組織で見えるはずのアーカイブが本番だけ見えなくなる。
    const { fga, batches } = recordingFga(["a"]);
    await viewableArchiveIds(fga, ALICE, ["a"]);

    const req = batches[0] as { checks: { contextualTuples: { tuple_keys: unknown[] } }[] };
    expect(req.checks[0]!.contextualTuples.tuple_keys).toEqual([
      { user: "user:alice", relation: "member", object: "organization:acme" },
      { user: "user:alice", relation: "member", object: "organization:beta" },
    ]);
  });

  it("`correlationId` を送らない", async () => {
    // SDK では任意で、**応答側で一度も読んでいない** (対応付けは request.object)。
    // 送らないのは行数のためではなく名前のため —— BrowserHive の取り込みにも
    // 同じ名前の別概念があり、並べると打ち消しのコメントが要る。実際、以前は
    // 2 か所目にそのコメントが伝播しなかった。
    const { fga, batches } = recordingFga([]);
    await viewableArchiveIds(fga, ALICE, ["a"]);

    const req = batches[0] as { checks: Record<string, unknown>[] };
    expect(req.checks[0]).not.toHaveProperty("correlationId");
  });

  it("空なら fga に触れない", async () => {
    // OpenFGA は checks が空の batchCheck を拒む。
    const touched = {
      batchCheck: () => Promise.reject(new Error("fga に触れた")),
    } as unknown as OpenFgaClient;
    await expect(viewableArchiveIds(touched, ALICE, [])).resolves.toEqual(new Set());
  });

  it("応答の順序に依存しない", async () => {
    // batchCheck の応答順は保証されない。添字で引くと、許可が別の id に付く。
    const fga = {
      batchCheck: (req: { checks: { object: string }[] }) =>
        Promise.resolve({
          result: [...req.checks]
            .reverse()
            .map((c) => ({ allowed: c.object === "archive:a", request: { object: c.object } })),
        }),
    } as unknown as OpenFgaClient;
    await expect(viewableArchiveIds(fga, ALICE, ["a", "b"])).resolves.toEqual(new Set(["a"]));
  });
});

describe("1 本を見てよいか", () => {
  it("許されていれば true", async () => {
    const { fga } = recordingFga(["a"]);
    await expect(mayViewArchive(fga, ALICE, "a")).resolves.toBe(true);
  });

  it("許されていなければ false", async () => {
    const { fga } = recordingFga([]);
    await expect(mayViewArchive(fga, ALICE, "a")).resolves.toBe(false);
  });

  it("所属を渡す", async () => {
    const { fga, singles } = recordingFga(["a"]);
    await mayViewArchive(fga, ALICE, "a");
    const call = singles[0] as { body: { contextualTuples: unknown[] } };
    expect(call.body.contextualTuples).toHaveLength(2);
  });

  it("強一貫を求める", async () => {
    // **この試験は形しか見ていない。** 偽の fga はキャッシュを持たないので、
    // 「古い許可が返らない」ことはここでは確かめられない —— 確かめるには本物の
    // OpenFGA に、取り消した直後の問い合わせを投げるしかない。
    //
    // それでも置いてあるのは、`consistency` を渡す行が消えたら赤くなるから。
    // **意味ではなく、その行の存在を守っている。**
    const { fga, singles } = recordingFga(["a"]);
    await mayViewArchive(fga, ALICE, "a");
    const call = singles[0] as { opts: { consistency: string } };
    expect(call.opts.consistency).toBe("HIGHER_CONSISTENCY");
  });
});
