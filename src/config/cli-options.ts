/**
 * Client CLI option parser.
 *
 * `--server`, `--tls-ca-cert`, and `--database-url` fall back to their
 * matching env vars (`BROWSERHIVE_SERVER`, `BROWSERHIVE_TLS_CA_CERT`,
 * `DATABASE_URL`) when omitted on the command line. Per-job flags
 * (`--png`, `--webp`, `--html`, `--mhtml`, `--limit`, `--dismiss-banners`,
 * `--accept-language`) intentionally have no env equivalents — they
 * are caller-side intent, not deployment configuration.
 *
 * `--server` has no commander-level default. When omitted, the generated
 * SDK falls back to its built-in baseUrl (extracted from `servers[0].url`
 * in `openapi/browserhive.yaml` at generation time), keeping the spec as
 * the single source of truth for the default address.
 */
import { Command, InvalidArgumentError, Option } from "commander";
import { logger } from "../logger.js";
import { redactDatabaseUrl } from "../db/pool.js";
import type { CaptureFormats } from "../types/capture.js";

export interface ClientOptions {
  server?: string;
  databaseUrl: string;
  png?: boolean;
  webp?: boolean;
  html?: boolean;
  links?: boolean;
  mhtml?: boolean;
  wacz?: boolean;
  limit?: number;
  tlsCaCert?: string;
  dismissBanners?: boolean;
  acceptLanguage?: string;
}

const parsePositiveInt = (value: string): number => {
  const num = parseInt(value, 10);
  if (isNaN(num) || num <= 0) {
    throw new InvalidArgumentError("Must be a positive integer");
  }
  return num;
};

// Reject empty / whitespace-only values up front; length and printable-ASCII
// constraints are enforced server-side by Ajv via the OpenAPI schema.
const parseNonEmpty = (value: string): string => {
  const trimmed = value.trim();
  if (trimmed === "") {
    throw new InvalidArgumentError("Must be a non-empty string");
  }
  return trimmed;
};

export const createProgram = (): Command => {
  const program = new Command();

  program
    .name("waggle")
    .description(
      "BrowserHive capture client — submit capture requests sourced from Postgres (fire-and-forget)",
    )
    .addOption(
      new Option(
        "--database-url <url>",
        "Postgres connection string (e.g. postgres://user:pass@host:5432/db). Required.",
      )
        .env("DATABASE_URL")
        .makeOptionMandatory(true),
    )
    .addOption(
      new Option(
        "--server <url>",
        "BrowserHive base URL. Defaults to the SDK's baked-in baseUrl (servers[0].url in openapi.yaml).",
      ).env("BROWSERHIVE_SERVER"),
    )
    .option("--png", "Capture PNG screenshot")
    .option("--webp", "Capture WebP screenshot")
    .option("--html", "Capture HTML")
    .option("--links", "Extract <a href> links to a .links.json file")
    .option("--mhtml", "Capture page as MHTML single-file archive")
    .option("--wacz", "Record the session as a WACZ replayable archive")
    .addOption(
      new Option("--limit <n>", "Maximum number of entries to read from the data file").argParser(
        parsePositiveInt,
      ),
    )
    .option("--dismiss-banners", "Run banner / modal dismissal before capturing (best-effort)")
    .addOption(
      new Option(
        "--accept-language <bcp47>",
        'Accept-Language header to forward upstream for every entry (e.g. "ja-JP,ja;q=0.9,en;q=0.8")',
      ).argParser(parseNonEmpty),
    )
    .addOption(
      new Option(
        "--tls-ca-cert <path>",
        "CA certificate file path for TLS (enables TLS when specified)",
      ).env("BROWSERHIVE_TLS_CA_CERT"),
    )
    .allowExcessArguments(false)
    .allowUnknownOption(false)
    .showHelpAfterError(true);

  return program;
};

export const parseClientOptions = (argv: string[]): ClientOptions => {
  const program = createProgram();
  program.parse(argv);

  const opts = program.opts<{
    databaseUrl: string;
    server?: string;
    png?: boolean;
    webp?: boolean;
    html?: boolean;
    links?: boolean;
    mhtml?: boolean;
    wacz?: boolean;
    limit?: number;
    tlsCaCert?: string;
    dismissBanners?: boolean;
    acceptLanguage?: string;
  }>();

  return {
    databaseUrl: opts.databaseUrl,
    ...(opts.server !== undefined && { server: opts.server }),
    ...(opts.png !== undefined && { png: opts.png }),
    ...(opts.webp !== undefined && { webp: opts.webp }),
    ...(opts.html !== undefined && { html: opts.html }),
    ...(opts.links !== undefined && { links: opts.links }),
    ...(opts.mhtml !== undefined && { mhtml: opts.mhtml }),
    ...(opts.wacz !== undefined && { wacz: opts.wacz }),
    ...(opts.limit !== undefined && { limit: opts.limit }),
    ...(opts.tlsCaCert !== undefined && { tlsCaCert: opts.tlsCaCert }),
    ...(opts.dismissBanners !== undefined && { dismissBanners: opts.dismissBanners }),
    ...(opts.acceptLanguage !== undefined && { acceptLanguage: opts.acceptLanguage }),
  };
};

export const getCaptureFormats = (options: ClientOptions): CaptureFormats => {
  return {
    png: options.png ?? false,
    webp: options.webp ?? false,
    html: options.html ?? false,
    links: options.links ?? false,
    mhtml: options.mhtml ?? false,
    wacz: options.wacz ?? false,
  };
};

export const logClientConfig = (options: ClientOptions): void => {
  logger.info(
    {
      server: options.server ?? "(SDK default)",
      tls: options.tlsCaCert
        ? { enabled: true, caCertPath: options.tlsCaCert }
        : { enabled: false },
      database: redactDatabaseUrl(options.databaseUrl),
      captureFormats: getCaptureFormats(options),
      dismissBanners: options.dismissBanners ?? false,
      acceptLanguage: options.acceptLanguage ?? null,
      limit: options.limit ?? null,
    },
    "Client configuration",
  );
};
