import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  parseClientOptions,
  getCaptureFormats,
  getCaptureSettings,
} from "../src/config/cli-options.js";

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
    expect(opts.webp).toBeUndefined();
  });

  it("parses every capture format flag", () => {
    const opts = parseClientOptions(
      argv(
        "--database-url",
        FAKE_DB_URL,
        "--png",
        "--webp",
        "--html",
        "--links",
        "--mhtml",
        "--wacz",
      ),
    );
    expect(opts.png).toBe(true);
    expect(opts.webp).toBe(true);
    expect(opts.html).toBe(true);
    expect(opts.links).toBe(true);
    expect(opts.mhtml).toBe(true);
    expect(opts.wacz).toBe(true);
  });

  it("parses --server, --limit, --accept-language, --dismiss-banners, --tls-ca-cert", () => {
    const opts = parseClientOptions(
      argv(
        "--database-url",
        FAKE_DB_URL,
        "--png",
        "--server",
        "browserhive.example:50051",
        "--limit",
        "5",
        "--accept-language",
        "ja-JP,ja;q=0.9",
        "--dismiss-banners",
        "--tls-ca-cert",
        "/etc/ssl/ca.pem",
      ),
    );
    expect(opts.server).toBe("browserhive.example:50051");
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
      webp: false,
      html: false,
      links: false,
      mhtml: false,
      wacz: false,
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
      webp: false,
      html: true,
      links: false,
      mhtml: false,
      wacz: false,
    });
  });
});

describe("getCaptureSettings", () => {
  it("carries the 1.6.0 knobs through from the command line", () => {
    const options = parseClientOptions(
      argv(
        "--database-url",
        FAKE_DB_URL,
        "--wacz",
        "--device-pixel-ratios",
        "1,2",
        "--operation-delay-ms",
        "250",
        "--behaviors",
        "autoscroll, autofetch",
        "--no-site-behaviors",
      ),
    );
    const settings = getCaptureSettings(options);

    // 順序まで見る —— [1, 2] と [2, 1] は別の指示で、画像の倍率が変わる。
    expect(settings.devicePixelRatios).toEqual([1, 2]);
    expect(settings.operationDelayMs).toBe(250);
    expect(settings.behaviors).toEqual({
      builtins: ["autoscroll", "autofetch"],
      siteBehaviors: false,
    });
  });

  // Absent keys, not undefined values: the request body is built by spreading
  // this object, and every one of these has a server-side default.
  it("leaves out every knob the caller did not pass", () => {
    const settings = getCaptureSettings(
      parseClientOptions(argv("--database-url", FAKE_DB_URL, "--png")),
    );

    expect(settings).toEqual({
      captureFormats: {
        png: true,
        webp: false,
        html: false,
        links: false,
        mhtml: false,
        wacz: false,
      },
      dismissBanners: false,
    });
  });

  it('treats --behaviors "" as "run no built-ins", which is not the same as omitting it', () => {
    const settings = getCaptureSettings(
      parseClientOptions(argv("--database-url", FAKE_DB_URL, "--png", "--behaviors", "")),
    );

    expect(settings.behaviors).toEqual({ builtins: [] });
  });
});
