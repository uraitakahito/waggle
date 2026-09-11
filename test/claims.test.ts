import { describe, it, expect } from "vitest";
import type { JWTPayload } from "jose";

import {
  ORGANIZATIONS_CLAIM,
  identityFromClaims,
  organizationsFromList,
} from "../src/config/identity.js";

// JWTPayload は index signature を持つので、そのまま渡せる。
const claims = (payload: Record<string, unknown>): JWTPayload => payload;

/**
 * クレームから主体を組む規則。**API と CLI が共有する。**
 *
 * 分けて持っていた頃、片方のクレーム名だけを変えると片方の試験しか赤くならず、
 * 「API は組織を読めるのに CLI は読めない」という状態が作れた。しかもその症状は
 * 「なぜか全部の取り込みが拒まれる」としか見えない —— CLI の組織が空になり、
 * 「自分が属さない組織の URL は投げない」検査に全部引っかかるため。
 */
describe("identityFromClaims", () => {
  it("sub と組織のクレームから Identity を組む", () => {
    expect(identityFromClaims(claims({ sub: "alice", [ORGANIZATIONS_CLAIM]: ["acme"] }))).toEqual({
      subject: "alice",
      organizations: ["acme"],
    });
  });

  it("sub が無ければ undefined", () => {
    expect(identityFromClaims(claims({ [ORGANIZATIONS_CLAIM]: ["acme"] }))).toBeUndefined();
  });

  it("sub が空文字なら undefined", () => {
    expect(identityFromClaims(claims({ sub: "" }))).toBeUndefined();
  });

  // 「どこにも属さない人」は表せる必要がある —— 組織が無いことは不正ではない。
  it("組織のクレームが無ければ、組織は空になる", () => {
    expect(identityFromClaims(claims({ sub: "alice" }))).toEqual({
      subject: "alice",
      organizations: [],
    });
  });

  it("組織のクレームが配列でなければ、組織は空になる", () => {
    expect(identityFromClaims(claims({ sub: "alice", [ORGANIZATIONS_CLAIM]: "acme" }))).toEqual({
      subject: "alice",
      organizations: [],
    });
  });

  it("空文字と文字列でない要素を落とす", () => {
    expect(
      identityFromClaims(claims({ sub: "alice", [ORGANIZATIONS_CLAIM]: ["acme", "", 42, null] })),
    ).toEqual({ subject: "alice", organizations: ["acme"] });
  });
});

/**
 * カンマ区切りから組織を読む規則。開発用ヘッダ (`X-Capture-ledger-Organizations`) と
 * 環境変数 (`CAPTURE_LEDGER_DEV_ORGANIZATIONS`) が同じ綴りを使う。
 */
describe("organizationsFromList", () => {
  it("カンマで割って前後の空白を落とす", () => {
    expect(organizationsFromList("acme, contoso")).toEqual(["acme", "contoso"]);
  });

  it("空の項目を落とす", () => {
    expect(organizationsFromList("acme,,  ,contoso")).toEqual(["acme", "contoso"]);
  });

  it("空文字なら空の一覧", () => {
    expect(organizationsFromList("")).toEqual([]);
  });
});
