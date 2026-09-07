/**
 * 開発用の OIDC issuer。**本番には無い。**
 *
 * ## 何のために在るか
 *
 * 本物の IdP を繋ぐ日に「初めて動くコード」を減らすために在る。ヘッダを信じる
 * resolver で開発していると、署名の検証・`iss` / `aud` の照合・有効期限・JWKS の
 * 取得と鍵の更新が、**その日まで一度も走らない**。ここが在れば毎日走る。
 *
 * だから狙いは「本物の IdP に似せること」ではなく、**検証する側のコードが本番と
 * 同じであること**。本物へ移るときに変わるのは `WAGGLE_OIDC_ISSUER` の値だけで、
 * `jwtIdentityResolver` は 1 行も変わらない。
 *
 * ## 鍵はここから出ない
 *
 * 起動のたびにメモリ上で作る。ファイルにも repo にも置かない —— 置き場が無ければ
 * 消し忘れる対象も無い。再起動で鍵が変わるのは欠点ではなく、**鍵の更新をそのまま
 * 再現できる**という意味になる (古いトークンが 401 になることを確かめられる)。
 *
 * ## `POST /token` は本物と違う形
 *
 * 意図的。本番でここに来るのは device flow か client credentials で、**どちらも
 * この endpoint とは別物**。名前で「開発用」と分けてあるので、本物が決まった日に
 * このファイルごと消える。
 */
import Fastify from "fastify";
import { SignJWT, exportJWK, generateKeyPair } from "jose";

import { optional } from "../config/env.js";
import { logger } from "../logger.js";

const ALG = "RS256";

/** 既定の待受。`WAGGLE_DEV_ISSUER_PORT` で変えられる。 */
export const DEFAULT_ISSUER_PORT = 9099;

/** 既定の `aud`。検証する側 (`resolveIdentityResolver`) と同じ値でなければならない。 */
export const DEFAULT_AUDIENCE = "waggle";

interface TokenRequest {
  /** JWT の `sub`。これが `submitted_by` と OpenFGA の owner tuple になる。 */
  subject?: unknown;
  /** 組織のクレーム。`membershipTuples` が contextual tuple に組み直す。 */
  organizations?: unknown;
  /** 有効期限。`jose` の綴り (`"1h"`, `"30m"`, `"-1h"` …)。 */
  expiresIn?: unknown;
}

const asStringArray = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((v): v is string => typeof v === "string" && v !== "") : [];

/**
 * issuer を組み立てる。`listen` はしない —— 待受は呼ぶ側が決める。
 *
 * `issuer` を省くと、**待ち受けている port から自分で決める**。トークンの `iss` と
 * JWKS を配る URL は必ず一致していなければならず、ずれると検証する側が
 * 「issuer が合わない」で落ちる (動きとしては正しいが、原因が分かりにくい)。
 * 自分で決めればずれようがない —— port 0 で OS に選ばせる試験でも同じ。
 */
export const buildDevIssuer = async (audience: string, issuer?: string) => {
  const { publicKey, privateKey } = await generateKeyPair(ALG, { extractable: true });
  const jwk = await exportJWK(publicKey);
  // `kid` を付けるのは本物に合わせるため。鍵が 1 本しか無くても、
  // 検証する側が複数鍵を扱う経路を通る。
  const kid = "dev-key-1";

  const app = Fastify({ logger: false });

  /** 待受が決まってから解決する。`listen` の前に呼んではいけない。 */
  const issuerUrl = (): string => {
    if (issuer !== undefined) return issuer;
    const address = app.server.address();
    if (address === null || typeof address === "string") {
      throw new Error("dev issuer: not listening yet");
    }
    return `http://127.0.0.1:${String(address.port)}`;
  };

  app.get("/.well-known/openid-configuration", () => ({
    issuer: issuerUrl(),
    jwks_uri: `${issuerUrl()}/.well-known/jwks.json`,
    // 本番でここに並ぶもの。開発用の issuer は実装していないが、
    // discovery 文書としての形は保つ。
    token_endpoint: `${issuerUrl()}/token`,
    id_token_signing_alg_values_supported: [ALG],
  }));

  app.get("/.well-known/jwks.json", () => ({ keys: [{ ...jwk, kid, alg: ALG, use: "sig" }] }));

  app.post("/token", async (request, reply) => {
    const body = (request.body ?? {}) as TokenRequest;
    const subject = typeof body.subject === "string" ? body.subject.trim() : "";
    if (subject === "") {
      return reply.code(400).send({ error: "subject is required" });
    }

    const token = await new SignJWT({ organizations: asStringArray(body.organizations) })
      .setProtectedHeader({ alg: ALG, kid })
      .setSubject(subject)
      .setIssuer(issuerUrl())
      .setAudience(audience)
      .setIssuedAt()
      .setExpirationTime(typeof body.expiresIn === "string" ? body.expiresIn : "1h")
      .sign(privateKey);

    return { access_token: token, token_type: "Bearer" };
  });

  return app;
};

/**
 * 起動する。**大声で警告する** —— `WAGGLE_DEV_IDENTITY` と同じ扱いで、
 * 本番の配備でこれが動いていることに気づけない状態を作らない。
 */
export const startDevIssuer = async (): Promise<void> => {
  // `??` は未設定のときしか既定値にしないので、空文字が素通りする。`optional` を使う。
  const port = Number(optional("WAGGLE_DEV_ISSUER_PORT", String(DEFAULT_ISSUER_PORT)));
  const issuer = optional("WAGGLE_OIDC_ISSUER", `http://127.0.0.1:${String(port)}`);
  const audience = optional("WAGGLE_OIDC_AUDIENCE", DEFAULT_AUDIENCE);

  const app = await buildDevIssuer(audience, issuer);
  await app.listen({ port, host: "127.0.0.1" });

  logger.warn(
    { issuer, audience, port },
    "DEV ISSUER — mints signed tokens for anyone who asks. Never run this outside local development.",
  );
};
