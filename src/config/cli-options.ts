/**
 * Client CLI option parser.
 *
 * `--server`, `--tls-ca-cert`, and `--database-url` fall back to their
 * matching env vars (`BROWSERHIVE_SERVER`, `BROWSERHIVE_TLS_CA_CERT`,
 * `DATABASE_URL`) when omitted on the command line. Per-job flags — the format
 * switches, `--limit`, `--dismiss-banners`, `--accept-language`, and the
 * capture knobs (`--device-scale-factor`, `--archive-mode`,
 * `--operation-delay-ms`, `--behaviors`, `--no-site-behaviors`) —
 * intentionally have no env equivalents: they are caller-side intent, not
 * deployment configuration. BrowserHive has its own env vars for the same
 * knobs, and those are what set the server-wide defaults.
 *
 * `--server` has no commander-level default. When omitted, the generated
 * SDK falls back to its built-in baseUrl (extracted from `servers[0].url`
 * in `openapi/browserhive.yaml` at generation time), keeping the spec as
 * the single source of truth for the default address.
 */
import { Command, InvalidArgumentError, Option } from "commander";
import { logger } from "../logger.js";
import { redactDatabaseUrl } from "../db/pool.js";
import type { CaptureFormats, CaptureSettings } from "../types/capture.js";

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
  deviceScaleFactor?: number;
  archiveMode?: "single-pass" | "multipass";
  operationDelayMs?: number;
  behaviors?: string[];
  siteBehaviors?: boolean;
  /**
   * Wait for each accepted capture and add the successful ones to the ledger.
   * `--no-collect` submits and exits, leaving `waggle fga:reconcile` to pick
   * the results up from the durable manifests later.
   */
  collect?: boolean;
  captureTimeoutMs?: number;
}

const parsePositiveInt = (value: string): number => {
  const num = parseInt(value, 10);
  if (isNaN(num) || num <= 0) {
    throw new InvalidArgumentError("Must be a positive integer");
  }
  return num;
};

const parseNonNegativeInt = (value: string): number => {
  const num = parseInt(value, 10);
  if (isNaN(num) || num < 0) {
    throw new InvalidArgumentError("Must be a non-negative integer");
  }
  return num;
};

// An empty `--behaviors ""` is meaningful: it turns every built-in off while
// leaving the server's site behaviors alone. Only the ids are trimmed.
const parseIdList = (value: string): string[] =>
  value
    .split(",")
    .map((id) => id.trim())
    .filter((id) => id !== "");

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
      "BrowserHive capture client — submit capture requests sourced from Postgres, then record the results in the archive ledger",
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
        "--device-scale-factor <n>",
        "Device pixel ratio the capture browser reports (1 or 2). 2 gives Retina-faithful WACZ replay.",
      ).argParser(parsePositiveInt),
    )
    .addOption(
      new Option(
        "--archive-mode <mode>",
        "How many passes the capture makes over the page",
      ).choices(["single-pass", "multipass"]),
    )
    .addOption(
      new Option(
        "--operation-delay-ms <ms>",
        "Delay before each browser operation, in ms. Slows a capture down enough to watch in a chrome://inspect screencast.",
      ).argParser(parseNonNegativeInt),
    )
    .addOption(
      new Option(
        "--behaviors <ids>",
        'Comma-separated built-in behavior ids (e.g. "autoscroll,autofetch"). Pass "" to run none.',
      ).argParser(parseIdList),
    )
    .option(
      "--no-site-behaviors",
      "Skip the site-specific behaviors BrowserHive bundles (they are considered on every capture by default)",
    )
    .option(
      "--no-collect",
      "Submit and exit without waiting for results (fga:reconcile picks them up from the bucket later)",
    )
    .option(
      "--capture-timeout-ms <ms>",
      "How long to wait for one capture before leaving it to fga:reconcile",
      parsePositiveInt,
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
    deviceScaleFactor?: number;
    archiveMode?: "single-pass" | "multipass";
    operationDelayMs?: number;
    behaviors?: string[];
    siteBehaviors?: boolean;
    collect?: boolean;
    captureTimeoutMs?: number;
  }>();

  return {
    databaseUrl: opts.databaseUrl,
    ...(opts.collect !== undefined && { collect: opts.collect }),
    ...(opts.captureTimeoutMs !== undefined && { captureTimeoutMs: opts.captureTimeoutMs }),
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
    ...(opts.deviceScaleFactor !== undefined && { deviceScaleFactor: opts.deviceScaleFactor }),
    ...(opts.archiveMode !== undefined && { archiveMode: opts.archiveMode }),
    ...(opts.operationDelayMs !== undefined && { operationDelayMs: opts.operationDelayMs }),
    ...(opts.behaviors !== undefined && { behaviors: opts.behaviors }),
    // commander sets this to `false` only when --no-site-behaviors was passed;
    // the default `true` means "not specified", which must stay off the wire.
    ...(opts.siteBehaviors === false && { siteBehaviors: false }),
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

/**
 * Collapse the per-run capture knobs into the object `submitRequest` spreads
 * into the request body.
 *
 * `captureFormats` and `dismissBanners` are always present — the server
 * requires the first and the second has a plain boolean default. Everything
 * else is only included when the caller actually asked for it, so BrowserHive
 * keeps applying its own defaults for the rest.
 */
export const getCaptureSettings = (options: ClientOptions): CaptureSettings => {
  const behaviors = {
    ...(options.behaviors !== undefined && { builtins: options.behaviors }),
    ...(options.siteBehaviors === false && { siteBehaviors: false }),
  };

  // #region capture-settings
  return {
    captureFormats: getCaptureFormats(options),
    dismissBanners: options.dismissBanners ?? false,
    ...(options.acceptLanguage !== undefined && { acceptLanguage: options.acceptLanguage }),
    ...(options.deviceScaleFactor !== undefined && {
      deviceScaleFactor: options.deviceScaleFactor,
    }),
    ...(options.archiveMode !== undefined && { archiveMode: options.archiveMode }),
    ...(options.operationDelayMs !== undefined && { operationDelayMs: options.operationDelayMs }),
    ...(Object.keys(behaviors).length > 0 && { behaviors }),
  };
  // #endregion capture-settings
};

export const logClientConfig = (options: ClientOptions): void => {
  const settings = getCaptureSettings(options);
  logger.info(
    {
      server: options.server ?? "(SDK default)",
      tls: options.tlsCaCert
        ? { enabled: true, caCertPath: options.tlsCaCert }
        : { enabled: false },
      database: redactDatabaseUrl(options.databaseUrl),
      // Log the settings object that is actually sent, so a surprising capture
      // can be explained from this one line rather than by guessing which
      // flags were in play.
      capture: settings,
      limit: options.limit ?? null,
    },
    "Client configuration",
  );
};
