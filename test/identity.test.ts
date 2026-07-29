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

  // No subject means no identity — the route answers 401 rather than falling
  // through to a Check for `user:undefined`.
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

  // The header resolver trusts whatever it is told, so an unconfigured
  // deployment must not get it by accident.
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
