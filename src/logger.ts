/**
 * Logger モジュール
 *
 * pino による集約ログ。
 * 上流の BrowserHive `src/logger.ts` からの移植。
 */
import pino from "pino";

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
