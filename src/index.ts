/**
 * Public library entry point.
 *
 * Stage 0 surface: the building blocks used by `cli.ts` are re-exported
 * so downstream callers can compose them programmatically (e.g. submit
 * from a different driver, drive a different CLI). The shape will
 * expand in later stages as polling / storage / pipeline features land.
 */
export { loadUrls, type DataEntry, type UrlSourceQuery } from "./data/url-source.js";
export { createPool, redactDatabaseUrl } from "./db/pool.js";
export {
  parseClientOptions,
  getCaptureFormats,
  logClientConfig,
  createProgram,
  type ClientOptions,
} from "./config/cli-options.js";
export type { CaptureFormats } from "./types/capture.js";
export { logger, createChildLogger, type Logger, type LoggerBindings } from "./logger.js";
export { configureClient } from "./client/openapi-client.js";
export { submitRequest, type SubmitResult } from "./client/submit.js";
export { runClient, submitAll } from "./client/run.js";
