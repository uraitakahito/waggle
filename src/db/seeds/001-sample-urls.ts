/**
 * 001-sample-urls
 *
 * Sample URLs used by local development and the prod-stack smoke test.
 *
 * Idempotency is provided by the `kysely_seed` ledger — the migrator
 * skips this file once it has been applied — so the original
 * `ON CONFLICT (url_hash) DO NOTHING` from the SQL seed is no longer
 * needed.
 *
 * `down` truncates with `RESTART IDENTITY` so the BIGSERIAL `id`
 * counter rewinds, leaving the table indistinguishable from a fresh
 * `CREATE TABLE` for round-trip tests.
 */
import type { Kysely } from "kysely";
import { sql } from "kysely";
import type { Database } from "../database.js";

export const up = async (db: Kysely<Database>): Promise<void> => {
  await db
    .insertInto("urls")
    .values([
      { url: "https://www.apple.com/", labels: ["Apple"] },
      { url: "https://www.microsoft.com/", labels: ["Microsoft"] },
      { url: "https://www.cloudflare.com/", labels: ["Cloudflare"] },
      { url: "https://www.ana.co.jp/group/", labels: ["9202", "ANAHoldings"] },
      { url: "https://www.datadoghq.com/", labels: ["Datadog"] },
    ])
    .execute();
};

export const down = async (db: Kysely<Database>): Promise<void> => {
  await sql`TRUNCATE TABLE urls RESTART IDENTITY`.execute(db);
};
