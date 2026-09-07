/**
 * このリクエストを出しているのが誰か。
 *
 * ## これは継ぎ目であって、実装ではない
 *
 * 呼び出し元を認証することは、認可することとは別の問題で、しかもまだ選んでいない
 * identity provider に依存する。認可の層がそこから必要とするものは小さく安定して
 * いる —— subject と、その人が属する組織 —— ので、その形だけをここで固定し、
 * 裏の検証は他に触れずに差し替えられるようにしてある。
 *
 * 下の開発用 resolver は header を信じる。それが安全なのは、明示的に有効化しない
 * 限り動くことを拒み、起動時に大きな声でそう言うから。本物の IdP が来たら、JWT を
 * 検証する resolver を足して既定にすればよい。`routes.ts` は何も変わらない。
 *
 * ## なぜ組織はトークンから来るのか
 *
 * 所属は OpenFGA に保存しない。リクエストごとに contextual tuple として渡すので、
 * 組織への参加や離脱を認可ストアへ同期する必要が一度も生じない —— その点については
 * トークンが既に出どころだから。代償は、取り消しがトークンの失効を待つこと。
 * トークンを短命にすべき理由がそれ。
 */
import type { FastifyRequest } from "fastify";
import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey, type JWTPayload } from "jose";
import { optional } from "../config/env.js";
import type { Identity } from "../config/identity.js";

export type { Identity };

export type IdentityResolver = (request: FastifyRequest) => Promise<Identity | undefined>;

/**
 * ローカル開発用の、header を信じる resolver。
 *
 * `X-Waggle-Subject` と `X-Waggle-Organizations` (カンマ区切り) をそのまま受け取る
 * —— そのポートに届く者は誰にでもなれる。`WAGGLE_DEV_IDENTITY=1` のときしか
 * 到達できない。
 */
export const devIdentityResolver: IdentityResolver = (request) => {
  const subject = request.headers["x-waggle-subject"];
  if (typeof subject !== "string" || subject === "") return Promise.resolve(undefined);

  const orgHeader = request.headers["x-waggle-organizations"];
  const organizations =
    typeof orgHeader === "string"
      ? orgHeader
          .split(",")
          .map((org) => org.trim())
          .filter((org) => org !== "")
      : [];

  return Promise.resolve({ subject, organizations });
};

/**
 * 組織のクレームを取り出す。
 *
 * **本物の IdP ごとに綴りが違う** (`groups` / `roles` / 独自の名前) ので、
 * 差し替えるのはここ 1 か所で済むように切ってある。
 *
 * 無いときは空。「どこにも属さない人」は表せる必要があり、不正ではない ——
 * その人は自分の組織のアーカイブを 1 つも見られない、というだけ。
 */
const readOrganizations = (payload: JWTPayload): string[] => {
  const claim = payload["organizations"];
  if (!Array.isArray(claim)) return [];
  return claim.filter((org): org is string => typeof org === "string" && org !== "");
};

/**
 * JWT を検証する resolver。**本番でもこれを使う。**
 *
 * 鍵を引数で受け取るのは、単体試験で issuer を立てないため。本番は
 * `createRemoteJWKSet(new URL(issuer + "/.well-known/jwks.json"))` を渡し、
 * 試験はその場で作った鍵を渡す —— `jwtVerify` がどちらも受ける。
 *
 * **開発でだけ鍵をファイルから読む形にはしない。** そうするとこの行が本番と
 * 別のものになり、「本番の経路を毎日動かす」という狙いがそこで崩れる。
 */
export const jwtIdentityResolver =
  (
    keys: JWTVerifyGetKey | CryptoKey,
    options: { issuer: string; audience: string },
  ): IdentityResolver =>
  async (request) => {
    const header = request.headers.authorization;
    if (typeof header !== "string" || !header.startsWith("Bearer ")) return undefined;

    try {
      const { payload } = await jwtVerify(header.slice("Bearer ".length), keys, options);
      if (typeof payload.sub !== "string" || payload.sub === "") return undefined;
      return { subject: payload.sub, organizations: readOrganizations(payload) };
    } catch {
      // 失敗の理由は呼び手に返さない。どこで落ちたかは総当たりの手がかりになる。
      return undefined;
    }
  };

/** 全員を拒む。これが既定なので、設定していない配備から漏れることはない。 */
export const denyAllResolver: IdentityResolver = () => Promise.resolve(undefined);

/**
 * 3 つのうちどれを使うか。**既定は拒否**。
 *
 * `WAGGLE_OIDC_ISSUER` が在れば JWT を検証する —— 開発用の issuer でも本物の IdP でも
 * 同じ経路を通り、違うのは URL だけ。無ければ従来どおり `WAGGLE_DEV_IDENTITY=1` の
 * ときにヘッダを信じ、それも無ければ全員を拒む。
 *
 * JWT が開発用ヘッダより優先されるのは、**両方設定されている環境で弱いほうへ
 * 落ちない**ようにするため。
 */
export const resolveIdentityResolver = (): IdentityResolver => {
  const issuer = optional("WAGGLE_OIDC_ISSUER", "");
  if (issuer !== "") {
    const audience = optional("WAGGLE_OIDC_AUDIENCE", "waggle");
    return jwtIdentityResolver(createRemoteJWKSet(new URL(`${issuer}/.well-known/jwks.json`)), {
      issuer,
      audience,
    });
  }
  return process.env["WAGGLE_DEV_IDENTITY"] === "1" ? devIdentityResolver : denyAllResolver;
};
