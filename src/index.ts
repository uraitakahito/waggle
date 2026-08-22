/**
 * ライブラリとしての公開の入口。
 *
 * Stage 0 の表面: `cli.ts` が使っている部品を再 export しているので、下流の
 * 呼び出し側がプログラムから組み合わせられる (別の driver から投げる、別の CLI を
 * 動かす、など)。polling / storage / pipeline の機能が入る後の段で、この形は
 * 広がっていく。
 */
export { loadUrls, type DataEntry, type UrlSourceQuery } from "./data/url-source.js";
export { createPool, maskPassword } from "./db/pool.js";
export {
  parseClientOptions,
  getCaptureFormats,
  logClientConfig,
  createProgram,
  type ClientOptions,
} from "./config/cli-options.js";
export type { CaptureFormats } from "./types/capture.js";
export { logger, createChildLogger, type Logger, type LoggerBindings } from "./logger.js";
export { closeClient, configureClient, DEFAULT_TARGET } from "./rpc/client.js";
export { submitRequest, type SubmitResult } from "./client/submit.js";
export { runClient, submitAll } from "./client/run.js";
