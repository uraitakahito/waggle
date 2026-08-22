import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type { FastifyRequest } from "fastify";
import {
  denyAllResolver,
  devIdentityResolver,
  resolveIdentityResolver,
} from "../src/api/identity.js";

const request = (headers: Record<string, string>): FastifyRequest =>
  ({ headers }) as unknown as FastifyRequest;

describe("devIdentityResolver", () => {
  it("reads the subject and organizations from headers", async () => {
    await expect(
      devIdentityResolver(
        request({ "x-waggle-subject": "bob", "x-waggle-organizations": "acme,contoso" }),
      ),
    ).resolves.toEqual({ subject: "bob", organizations: ["acme", "contoso"] });
  });

  it("trims and drops empty organization entries", async () => {
    await expect(
      devIdentityResolver(
        request({ "x-waggle-subject": "bob", "x-waggle-organizations": " acme , , contoso ," }),
      ),
    ).resolves.toEqual({ subject: "bob", organizations: ["acme", "contoso"] });
  });

  it("yields no organizations when the header is absent", async () => {
    await expect(devIdentityResolver(request({ "x-waggle-subject": "bob" }))).resolves.toEqual({
      subject: "bob",
      organizations: [],
    });
  });

  // subject が無いことは identity が無いということ —— route は `user:undefined` に
  // 対する Check へ落ちるのではなく、401 で答える。
  it("returns undefined without a subject", async () => {
    await expect(devIdentityResolver(request({}))).resolves.toBeUndefined();
    await expect(devIdentityResolver(request({ "x-waggle-subject": "" }))).resolves.toBeUndefined();
  });
});

describe("resolveIdentityResolver", () => {
  const original = process.env["WAGGLE_DEV_IDENTITY"];
  beforeEach(() => {
    delete process.env["WAGGLE_DEV_IDENTITY"];
  });
  afterEach(() => {
    if (original === undefined) delete process.env["WAGGLE_DEV_IDENTITY"];
    else process.env["WAGGLE_DEV_IDENTITY"] = original;
  });

  // header の resolver は言われたことを何でも信じるので、設定していない配備が
  // 事故でそれを手にしてはならない。
  it("denies everyone by default", async () => {
    expect(resolveIdentityResolver()).toBe(denyAllResolver);
    await expect(
      resolveIdentityResolver()(request({ "x-waggle-subject": "mallory" })),
    ).resolves.toBeUndefined();
  });

  it("only enables the dev resolver on an exact opt-in", () => {
    process.env["WAGGLE_DEV_IDENTITY"] = "true";
    expect(resolveIdentityResolver()).toBe(denyAllResolver);
    process.env["WAGGLE_DEV_IDENTITY"] = "1";
    expect(resolveIdentityResolver()).toBe(devIdentityResolver);
  });
});
