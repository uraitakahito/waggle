/**
 * 実行の主体 —— 誰が、どの組織のために動かしているか。
 *
 * ## これは足場であって、認証ではない
 *
 * `devIdentity()` は環境変数を読むだけで、**何も検証しない**。値を書いた人が
 * そのまま名乗れる。本物の identity provider が決まるまでの間、`submitted_by` と
 * OpenFGA の owner tuple を埋めるためだけに在る。
 *
 * 呼ぶ側 (CLI も API も) が見るのは `Identity` という型だけなので、IdP が来たら
 * この関数と `api/identity.ts` の resolver を差し替えれば、`run.ts` も
 * `register.ts` も変わらない。`api/identity.ts` が既に述べている「継ぎ目であって
 * 実装ではない」を、CLI 側にも広げたもの。
 */
import { collectEnv, optional, type Need } from "./env.js";

export interface Identity {
  subject: string;
  organizations: string[];
}

const splitList = (value: string): string[] =>
  value
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item !== "");

/**
 * 既定値は持たない。設定を忘れた配備が黙って動き、`submitted_by` が嘘の値で
 * 埋まるほうが、null のままより悪い —— `env.ts` と同じ方針。
 *
 * `WAGGLE_DEV_` という接頭辞は意図的。本物が入ったとき、grep で残骸を全部
 * 見つけられる。
 */
export const identityFrom = (need: Need): Identity => ({
  subject: need("WAGGLE_DEV_SUBJECT"),
  organizations: splitList(optional("WAGGLE_DEV_ORGANIZATIONS", "")),
});

export const devIdentity = (): Identity => collectEnv(identityFrom);
