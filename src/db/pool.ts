/**
 * Postgres pool factory.
 *
 * One pool per process. Pool errors (idle-client failures, network blips
 * that break a checked-out connection) are surfaced through the logger
 * rather than crashing the process — pg's pool re-establishes the
 * connection on the next checkout.
 */
import { Pool } from "pg";
import { logger } from "../logger.js";

export const createPool = (databaseUrl: string): Pool => {
  const pool = new Pool({ connectionString: databaseUrl });
  pool.on("error", (err) => {
    logger.error({ err }, "Postgres pool error");
  });
  return pool;
};

/**
 * Strip the password component from a Postgres connection URL so it can
 * be safely logged. Returns the original string unchanged when it does
 * not parse as a URL (host:port style strings, etc.).
 */
export const redactDatabaseUrl = (url: string): string => {
  try {
    const parsed = new URL(url);
    if (parsed.password) parsed.password = "***";
    return parsed.toString();
  } catch {
    return url;
  }
};
