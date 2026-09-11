import { describe, it, expect } from "vitest";
import type { FastifyRequest } from "fastify";
import { createRemoteJWKSet } from "jose";

import { buildDevIssuer } from "../src/dev/issuer.js";
import { jwtIdentityResolver } from "../src/api/identity.js";

/**
 * 開発用の issuer が刷ったトークンを、**本番の resolver が受け取れること**。
 *
 * これがこの一連の狙いそのもの。単体では鍵を直接渡して試せるが、それだけだと
 * 「JWKS を HTTP で取ってくる経路」が一度も走らない —— 本番で使うのはそちら。
 * ここは `createRemoteJWKSet` を通し、issuer を実際に立てて確かめる。
 */
describe("開発用の issuer", () => {
  const AUDIENCE = "capture-ledger";

  /**
   * issuer を立てて URL を渡す。片付けまで面倒を見る。
   *
   * port 0 で OS に選ばせる —— 固定すると並行して走る試験とぶつかる。
   * `iss` は issuer 自身が待受から導くので、こちらは port を知る必要が無い。
   */
  const withIssuer = async (body: (issuer: string) => Promise<void>): Promise<void> => {
    const app = await buildDevIssuer(AUDIENCE);
    const address = await app.listen({ port: 0, host: "127.0.0.1" });
    try {
      await body(address);
    } finally {
      await app.close();
    }
  };

  const mint = async (issuer: string, payload: Record<string, unknown>): Promise<string> => {
    const response = await fetch(`${issuer}/token`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    const json = (await response.json()) as { access_token?: string };
    return json.access_token ?? "";
  };

  it("刷ったトークンを、JWKS 越しに本番の resolver が受け取る", async () => {
    await withIssuer(async (issuer) => {
      const token = await mint(issuer, { subject: "alice", organizations: ["acme"] });

      const resolve = jwtIdentityResolver(
        createRemoteJWKSet(new URL(`${issuer}/.well-known/jwks.json`)),
        { issuer, audience: AUDIENCE },
      );

      await expect(
        resolve({ headers: { authorization: `Bearer ${token}` } } as unknown as FastifyRequest),
      ).resolves.toEqual({ subject: "alice", organizations: ["acme"] });
    });
  });

  it("discovery が jwks_uri を指す", async () => {
    await withIssuer(async (issuer) => {
      const response = await fetch(`${issuer}/.well-known/openid-configuration`);
      await expect(response.json()).resolves.toMatchObject({
        issuer,
        jwks_uri: `${issuer}/.well-known/jwks.json`,
      });
    });
  });

  it("subject を省いた要求は 400 で拒む", async () => {
    await withIssuer(async (issuer) => {
      const response = await fetch(`${issuer}/token`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ organizations: ["acme"] }),
      });
      expect(response.status).toBe(400);
    });
  });

  /**
   * 鍵は issuer の起動ごとに作り直される。**それが正しい** ——
   * 鍵の更新をローカルで再現できるということ。古いトークンは通らなくなる。
   */
  it("issuer を立て直すと、前の鍵で刷ったトークンは通らない", async () => {
    const first = await buildDevIssuer(AUDIENCE);
    const address = await first.listen({ port: 0, host: "127.0.0.1" });
    const token = await mint(address, { subject: "alice" });
    await first.close();

    // 同じ port で立て直す = URL は同じで、鍵だけが変わる。
    const second = await buildDevIssuer(AUDIENCE, address);
    await second.listen({ port: Number(new URL(address).port), host: "127.0.0.1" });
    try {
      const resolve = jwtIdentityResolver(
        createRemoteJWKSet(new URL(`${address}/.well-known/jwks.json`)),
        { issuer: address, audience: AUDIENCE },
      );
      await expect(
        resolve({ headers: { authorization: `Bearer ${token}` } } as unknown as FastifyRequest),
      ).resolves.toBeUndefined();
    } finally {
      await second.close();
    }
  });
});
