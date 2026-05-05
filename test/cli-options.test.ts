import { describe, it, expect } from "vitest";
import { parseClientOptions, getCaptureFormats } from "../src/config/cli-options.js";

const argv = (...args: string[]): string[] => ["node", "waggle", ...args];

describe("parseClientOptions", () => {
  it("parses --data and a single capture format", () => {
    const opts = parseClientOptions(argv("--data", "data/sample.yaml", "--png"));
    expect(opts.data).toBe("data/sample.yaml");
    expect(opts.png).toBe(true);
    expect(opts.jpeg).toBeUndefined();
  });

  it("parses every capture format flag", () => {
    const opts = parseClientOptions(
      argv("--data", "x.yaml", "--png", "--jpeg", "--html", "--links", "--pdf"),
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
        "--data",
        "x.yaml",
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
      argv("--data", "x.yaml", "--png", "--accept-language", "  ja-JP  "),
    );
    expect(opts.acceptLanguage).toBe("ja-JP");
  });

  it("omits unset optional fields", () => {
    const opts = parseClientOptions(argv("--data", "x.yaml", "--png"));
    expect(opts).not.toHaveProperty("server");
    expect(opts).not.toHaveProperty("limit");
    expect(opts).not.toHaveProperty("acceptLanguage");
    expect(opts).not.toHaveProperty("tlsCaCert");
    expect(opts).not.toHaveProperty("dismissBanners");
  });
});

describe("getCaptureFormats", () => {
  it("normalises unset flags to false", () => {
    const formats = getCaptureFormats({ data: "x.yaml" });
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
      data: "x.yaml",
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
