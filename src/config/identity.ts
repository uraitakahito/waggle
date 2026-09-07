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
import { decodeJwt } from "jose";

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
 * トークンから主体を読む。
 *
 * **署名は検証しない。** CLI が持っているのは自分に配られたトークンで、
 * 検証するのは受け取る側 (API と、いずれ browserhive) の仕事 —— ここで検証しても
 * 「自分で自分を信じた」以上の意味を持たない。読むのは `sub` と組織のクレームだけで、
 * その値が本当に通るかどうかは、投げた先が判断する。
 *
 * 本番で device flow や client credentials を足すとき、差し替わるのは
 * 「トークンをどこから得るか」だけで、この読み取りは変わらない。
 */
const identityFromToken = (token: string): Identity | undefined => {
  try {
    const payload = decodeJwt(token);
    if (typeof payload.sub !== "string" || payload.sub === "") return undefined;
    const claim = payload["organizations"];
    return {
      subject: payload.sub,
      organizations: Array.isArray(claim)
        ? claim.filter((org): org is string => typeof org === "string" && org !== "")
        : [],
    };
  } catch {
    return undefined;
  }
};

/**
 * 主体を決める。**トークンが在ればそれを使う。**
 *
 * 順序が大事で、`WAGGLE_OIDC_TOKEN` を先に見る —— 両方設定された環境で、
 * 弱いほう (誰でも名乗れる環境変数) へ落ちないようにするため。API 側の
 * `resolveIdentityResolver` と同じ考え方。
 *
 * どちらも無ければ落とす。既定値は持たない —— 設定を忘れた配備が黙って動き、
 * `submitted_by` が嘘の値で埋まるほうが、落ちるより悪い。
 *
 * `WAGGLE_DEV_` という接頭辞は意図的。本物が入ったとき、grep で残骸を全部
 * 見つけられる。
 */
export const identityFrom = (need: Need): Identity => {
  const token = optional("WAGGLE_OIDC_TOKEN", "");
  if (token !== "") {
    const identity = identityFromToken(token);
    if (identity !== undefined) return identity;
    throw new Error("WAGGLE_OIDC_TOKEN は JWT として読めないか、sub を持っていない");
  }
  return {
    subject: need("WAGGLE_DEV_SUBJECT"),
    organizations: splitList(optional("WAGGLE_DEV_ORGANIZATIONS", "")),
  };
};

export const devIdentity = (): Identity => collectEnv(identityFrom);
