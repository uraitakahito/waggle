/**
 * 実行の主体 —— 誰が、どの組織のために動かしているか。
 *
 * ## これは形であって、認証ではない
 *
 * ここに在るのは **クレームの読み方** だけで、検証はしない。署名を確かめるのは
 * `api/identity.ts` の resolver の仕事で、こちらは「読めた payload から Identity を
 * どう組み立てるか」を 1 か所に置くためのもの。
 *
 * 入口は API だけになった。以前は CLI 用の経路がもう 1 本あり、環境変数
 * (CAPTURE_LEDGER_DEV_SUBJECT / CAPTURE_LEDGER_DEV_ORGANIZATIONS / CAPTURE_LEDGER_OIDC_TOKEN) から主体を
 * 組み立てていたが、その呼び出し元ごと畳んだので消えている。IdP が来たときに
 * 差し替わるのは `api/identity.ts` の resolver のほうで、この型は変わらない。
 */
import type { JWTPayload } from "jose";

export interface Identity {
  subject: string;
  organizations: string[];
}

/**
 * 組織のクレームの綴り。**IdP ごとに違うのはここだけ** (`groups` / `roles` / 独自)。
 *
 * 定数にしてあるのは、試験が同じものを参照できるようにするため —— そうすると
 * 名前を変えたときに API 側と CLI 側の試験が **同時に** 赤くなる。以前は 2 か所に
 * 直書きしてあり、片方を変えても片方の試験しか落ちなかった。
 */
export const ORGANIZATIONS_CLAIM = "organizations";

/**
 * カンマ区切りから組織を読む。いまの読み手は開発用ヘッダ
 * `X-Capture-ledger-Organizations` だけ。
 *
 * 以前は `CAPTURE_LEDGER_DEV_ORGANIZATIONS` と綴りを共有していて「片方だけ空白の落とし方が
 * 変わってはいけない」ことが分けてある理由だったが、**その環境変数を読む場所は
 * 上に書いたとおり畳んで消えた。** いま呼ぶのは `api/identity.ts` の 1 か所だけで、
 * 関数のまま残しているのは `test/claims.test.ts` が空要素の落とし方を直接見ているから
 * —— `,,  ,` のような入力の扱いは、ヘッダ経路の中に埋めると誰も見なくなる。
 */
export const organizationsFromList = (value: string): string[] =>
  value
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item !== "");

/**
 * 検証済みのクレームから主体を組む。**API と CLI が共有する。**
 *
 * **ここは検証しない。** 呼ぶ側が済ませている —— API は `jwtVerify` で、
 * CLI は `decodeJwt` で「検証しない」と決めたうえで。この関数が答えるのは
 * 「そのクレームが、どんな `Identity` を表すか」だけ。
 *
 * 組織が無いのは不正ではない。「どこにも属さない人」は表せる必要があり、
 * その人は自分の組織のアーカイブを 1 つも見られない、というだけ。
 */
export const identityFromClaims = (payload: JWTPayload): Identity | undefined => {
  if (typeof payload.sub !== "string" || payload.sub === "") return undefined;
  const claim = payload[ORGANIZATIONS_CLAIM];
  return {
    subject: payload.sub,
    organizations: Array.isArray(claim)
      ? claim.filter((org): org is string => typeof org === "string" && org !== "")
      : [],
  };
};
