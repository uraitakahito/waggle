/**
 * Client CLI option parser.
 *
 * `--server` and `--tls-ca-cert` fall back to `BROWSERHIVE_SERVER` /
 * `BROWSERHIVE_TLS_CA_CERT` when not given on the command line. Per-job
 * flags (`--data`, `--png`, `--jpeg`, `--html`, `--limit`,
 * `--dismiss-banners`, `--accept-language`) intentionally have no env
 * equivalents — they are caller-side intent, not deployment configuration.
 *
 * `--server` has no commander-level default. When omitted, the generated
 * SDK falls back to its built-in baseUrl (extracted from `servers[0].url`
 * in `openapi/browserhive.yaml` at generation time), keeping the spec as
 * the single source of truth for the default address.
 *
 * Ported from upstream BrowserHive `src/cli/client-cli.ts` with the CLI
 * name changed from `browserhive-example` to `waggle`.
 */
import { Command, InvalidArgumentError, Option } from "commander";
import { logger } from "../logger.js";
import type { CaptureFormats } from "../types/capture.js";

export interface ClientOptions {
  server?: string;
  data: string;
  png?: boolean;
  jpeg?: boolean;
  html?: boolean;
  links?: boolean;
  pdf?: boolean;
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
      "BrowserHive capture client — submit capture requests from a YAML data file (fire-and-forget)",
    )
    .requiredOption("--data <path>", "YAML data file path")
    .addOption(
      new Option(
        "--server <url>",
        "BrowserHive base URL. Defaults to the SDK's baked-in baseUrl (servers[0].url in openapi.yaml).",
      ).env("BROWSERHIVE_SERVER"),
    )
    .option("--png", "Capture PNG screenshot")
    .option("--jpeg", "Capture JPEG screenshot")
    .option("--html", "Capture HTML")
    .option("--links", "Extract <a href> links to a .links.json file")
    .option("--pdf", "Render the page to PDF (Chromium print pipeline, A4)")
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
    data: string;
    server?: string;
    png?: boolean;
    jpeg?: boolean;
    html?: boolean;
    links?: boolean;
    pdf?: boolean;
    limit?: number;
    tlsCaCert?: string;
    dismissBanners?: boolean;
    acceptLanguage?: string;
  }>();

  return {
    data: opts.data,
    ...(opts.server !== undefined && { server: opts.server }),
    ...(opts.png !== undefined && { png: opts.png }),
    ...(opts.jpeg !== undefined && { jpeg: opts.jpeg }),
    ...(opts.html !== undefined && { html: opts.html }),
    ...(opts.links !== undefined && { links: opts.links }),
    ...(opts.pdf !== undefined && { pdf: opts.pdf }),
    ...(opts.limit !== undefined && { limit: opts.limit }),
    ...(opts.tlsCaCert !== undefined && { tlsCaCert: opts.tlsCaCert }),
    ...(opts.dismissBanners !== undefined && { dismissBanners: opts.dismissBanners }),
    ...(opts.acceptLanguage !== undefined && { acceptLanguage: opts.acceptLanguage }),
  };
};

export const getCaptureFormats = (options: ClientOptions): CaptureFormats => {
  return {
    png: options.png ?? false,
    jpeg: options.jpeg ?? false,
    html: options.html ?? false,
    links: options.links ?? false,
    pdf: options.pdf ?? false,
  };
};

export const logClientConfig = (options: ClientOptions): void => {
  logger.info(
    {
      server: options.server ?? "(SDK default)",
      tls: options.tlsCaCert
        ? { enabled: true, caCertPath: options.tlsCaCert }
        : { enabled: false },
      data: options.data,
      captureFormats: getCaptureFormats(options),
      dismissBanners: options.dismissBanners ?? false,
      acceptLanguage: options.acceptLanguage ?? null,
      limit: options.limit ?? null,
    },
    "Client configuration",
  );
};
