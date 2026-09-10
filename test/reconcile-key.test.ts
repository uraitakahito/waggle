/**
 * manifest の鍵から taskId を読む 1 行を固める。
 *
 * ここは**オブジェクトを取りに行かずに済ませる**ための工夫で、最も多い場合
 * （既に台帳に在る manifest）の GET を 0 回にしている。安いぶん、鍵の綴りに
 * 強く依存する。
 *
 * **試験が無かったせいで、prefix を入れた日に黙って壊れた。** 受け口が受けた成果物は
 * `org/<orgId>/…` に在るので、鍵をそのまま `_` で切ると `org/acme/<taskId>` が返る。
 * それは uuid ではないので、`archives` や `capture_submissions` を引いた瞬間に
 * Postgres が落ちる —— つまり **受け口を有効にすると `reconcile` が throw する**
 * 状態だった。
 */
import { describe, expect, it } from "vitest";

import { taskIdFromKey } from "../src/archive/reconcile.js";

const TASK = "550e8400-e29b-41d4-a716-446655440000";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

describe("manifest の鍵から taskId", () => {
  it("平らな配置（BrowserHive が自前の保管庫へ書く経路）", () => {
    expect(taskIdFromKey(`${TASK}__test.result.json`)).toBe(TASK);
  });

  it("受け口が受けた配置（org の prefix つき）", () => {
    // **prefix を巻き込まない。** ここが壊れると uuid 列への問い合わせで落ちる。
    expect(taskIdFromKey(`org/acme/${TASK}__test.result.json`)).toBe(TASK);
  });

  it("prefix が深くても読める", () => {
    expect(taskIdFromKey(`org/acme/2026-09/${TASK}_abc123de.result.json`)).toBe(TASK);
  });

  it("correlationId と labels は含めない", () => {
    expect(taskIdFromKey(`org/acme/${TASK}_abc123de_9202_ANAHoldings.result.json`)).toBe(TASK);
  });

  it("どの配置でも uuid の形になる", () => {
    // **これが本題。** 返り値は uuid 列への問い合わせにそのまま渡る。
    for (const key of [
      `${TASK}_.result.json`,
      `org/acme/${TASK}_.result.json`,
      `org/acme/2026-09/${TASK}__x.result.json`,
    ]) {
      expect(taskIdFromKey(key)).toMatch(UUID);
    }
  });
});
