import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { SignJWT, generateKeyPair } from "jose";

import { devIdentity } from "../src/config/identity.js";

const keys = await generateKeyPair("RS256");

const token = (claims: Record<string, unknown>): Promise<string> =>
  new SignJWT(claims)
    .setProtectedHeader({ alg: "RS256" })
    .setIssuedAt()
    .setExpirationTime("1h")
    .sign(keys.privateKey);

/**
 * CLI 側の主体。API と違って、ここは **署名を検証しない** ——
 * CLI が持っているのは自分に配られたトークンで、検証は受け取る側の仕事。
 * 読むのは sub と組織のクレームだけ。
 */
describe("CLI の identity", () => {
  const saved = { ...process.env };
  beforeEach(() => {
    delete process.env["WAGGLE_OIDC_TOKEN"];
    delete process.env["WAGGLE_DEV_SUBJECT"];
    delete process.env["WAGGLE_DEV_ORGANIZATIONS"];
  });
  afterEach(() => {
    process.env = { ...saved };
  });

  it("環境変数から主体を組み立てる", () => {
    process.env["WAGGLE_DEV_SUBJECT"] = "alice";
    process.env["WAGGLE_DEV_ORGANIZATIONS"] = "acme, contoso";
    expect(devIdentity()).toEqual({ subject: "alice", organizations: ["acme", "contoso"] });
  });

  it("トークンが在れば、そこから主体を読む", async () => {
    process.env["WAGGLE_OIDC_TOKEN"] = await token({ sub: "bob", organizations: ["acme"] });
    expect(devIdentity()).toEqual({ subject: "bob", organizations: ["acme"] });
  });

  // 両方設定された環境で、誰でも名乗れるほうへ落ちてはいけない。
  it("トークンは環境変数より優先される", async () => {
    process.env["WAGGLE_DEV_SUBJECT"] = "mallory";
    process.env["WAGGLE_OIDC_TOKEN"] = await token({ sub: "bob" });
    expect(devIdentity()).toEqual({ subject: "bob", organizations: [] });
  });

  it("読めないトークンは落とす", () => {
    process.env["WAGGLE_OIDC_TOKEN"] = "not-a-jwt";
    process.env["WAGGLE_DEV_SUBJECT"] = "alice";
    expect(() => devIdentity()).toThrow(/JWT として読めない/);
  });

  it("sub の無いトークンは落とす", async () => {
    process.env["WAGGLE_OIDC_TOKEN"] = await token({ organizations: ["acme"] });
    expect(() => devIdentity()).toThrow(/JWT として読めない/);
  });

  it("どちらも無ければ落とす", () => {
    expect(() => devIdentity()).toThrow(/WAGGLE_DEV_SUBJECT/);
  });
});
