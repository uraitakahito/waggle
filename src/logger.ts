/**
 * Logger モジュール
 *
 * pino による集約ログ。
 * 上流の BrowserHive `src/logger.ts` からの移植。
 */
import pino from "pino";
import { MissingEnvError } from "./config/env.js";

export type Logger = pino.Logger;
export type LoggerBindings = pino.Bindings;

/**
 * root の logger インスタンス。
 * ログレベルは環境変数 LOG_LEVEL で変えられる。
 */
export const logger = pino({
  level: process.env["LOG_LEVEL"] ?? "info",
});

/**
 * context の binding を足した child logger を作る。
 * taskId や correlationId などを全ログ行に載せたいときに使う。
 */
export const createChildLogger = (bindings: LoggerBindings): Logger => {
  return logger.child(bindings);
};

/**
 * 致命的な失敗の出口。3 つのエントリ点 (submit-captures / ledger-commands /
 * api/server) が同じ形で使う。
 *
 * `MissingEnvError` だけは logger を通さず stderr にそのまま書く。**pino の
 * 出力は JSON なので、改行を含むメッセージは `\n` に潰れて 1 行の中に埋まる。**
 * 足りない変数を並べて読ませるのが目的なのに、それが読めなくなる。設定を直す人は
 * まだ何も動かせていないので、機械可読なログ行より、そのまま読める文章のほうが
 * 役に立つ。
 */
export const fatal = (error: unknown): never => {
  if (error instanceof MissingEnvError) {
    process.stderr.write(`${error.message}\n`);
  } else {
    logger.fatal({ err: error }, "Fatal error");
  }
  process.exit(1);
};
