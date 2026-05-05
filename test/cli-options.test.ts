import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { parseClientOptions, getCaptureFormats } from "../src/config/cli-options.js";

const argv = (...args: string[]): string[] => ["node", "waggle", ...args];

const FAKE_DB_URL = "postgres://waggle:secret@db.local:5432/waggle";

describe("parseClientOptions", () => {
  let originalDatabaseUrl: string | undefined;

  beforeEach(() => {
    originalDatabaseUrl = process.env["DATABASE_URL"];
    delete process.env["DATABASE_URL"];
  });

  afterEach(() => {
    if (originalDatabaseUrl === undefined) {
      delete process.env["DATABASE_URL"];
    } else {
      process.env["DATABASE_URL"] = originalDatabaseUrl;
    }
  });

  it("parses --database-url and a single capture format", () => {
    const opts = parseClientOptions(argv("--database-url", FAKE_DB_URL, "--png"));
    expect(opts.databaseUrl).toBe(FAKE_DB_URL);
    expect(opts.png).toBe(true);
    expect(opts.jpeg).toBeUndefined();
  });

  it("parses every capture format flag", () => {
    const opts = parseClientOptions(
      argv("--database-url", FAKE_DB_URL, "--png", "--jpeg", "--html", "--links", "--pdf"),
    );
    expect(opts.png).toBe(true);
    expect(opts.jpeg).toBe(true);
    expect(opts.html).toBe(true);
    expect(opts.links).toBe(true);
    expect(opts.pdf).toBe(true);
  });

  it("parses --server, --limit, --accept-language, --dismiss-banners, --tls-ca-cert", () => {
    const opts = parseClientOptions(
      argv(
        "--database-url",
        FAKE_DB_URL,
        "--png",
        "--server",
        "http://localhost:8080",
        "--limit",
        "5",
        "--accept-language",
        "ja-JP,ja;q=0.9",
        "--dismiss-banners",
        "--tls-ca-cert",
        "/etc/ssl/ca.pem",
      ),
    );
    expect(opts.server).toBe("http://localhost:8080");
    expect(opts.limit).toBe(5);
    expect(opts.acceptLanguage).toBe("ja-JP,ja;q=0.9");
    expect(opts.dismissBanners).toBe(true);
    expect(opts.tlsCaCert).toBe("/etc/ssl/ca.pem");
  });

  it("trims whitespace from --accept-language", () => {
    const opts = parseClientOptions(
      argv("--database-url", FAKE_DB_URL, "--png", "--accept-language", "  ja-JP  "),
    );
    expect(opts.acceptLanguage).toBe("ja-JP");
  });

  it("falls back to DATABASE_URL env var when --database-url is omitted", () => {
    process.env["DATABASE_URL"] = FAKE_DB_URL;
    const opts = parseClientOptions(argv("--png"));
    expect(opts.databaseUrl).toBe(FAKE_DB_URL);
  });

  it("omits unset optional fields", () => {
    const opts = parseClientOptions(argv("--database-url", FAKE_DB_URL, "--png"));
    expect(opts).not.toHaveProperty("server");
    expect(opts).not.toHaveProperty("limit");
    expect(opts).not.toHaveProperty("acceptLanguage");
    expect(opts).not.toHaveProperty("tlsCaCert");
    expect(opts).not.toHaveProperty("dismissBanners");
  });
});

describe("getCaptureFormats", () => {
  it("normalises unset flags to false", () => {
    const formats = getCaptureFormats({ databaseUrl: FAKE_DB_URL });
    expect(formats).toEqual({
      png: false,
      jpeg: false,
      html: false,
      links: false,
      pdf: false,
    });
  });

  it("forwards set flags as true", () => {
    const formats = getCaptureFormats({
      databaseUrl: FAKE_DB_URL,
      png: true,
      html: true,
    });
    expect(formats).toEqual({
      png: true,
      jpeg: false,
      html: true,
      links: false,
      pdf: false,
    });
  });
});
