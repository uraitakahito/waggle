/**
 * Logger Module
 *
 * Centralized logging using pino.
 * Ported from upstream BrowserHive `src/logger.ts`.
 */
import pino from "pino";

export type Logger = pino.Logger;
export type LoggerBindings = pino.Bindings;

/**
 * Root logger instance. Log level controlled via LOG_LEVEL env var.
 */
export const logger = pino({
  level: process.env["LOG_LEVEL"] ?? "info",
});

/**
 * Create a child logger with additional context bindings.
 */
export const createChildLogger = (bindings: LoggerBindings): Logger => {
  return logger.child(bindings);
};
