/**
 * 001-sample-capture-targets
 *
 * ローカルの開発と本番構成の smoke test が使うサンプルの URL。
 *
 * 冪等性は `kysely_seed` の記録が与える —— 一度当たったファイルを migrator が
 * 飛ばす —— ので、SQL の seed に在った `ON CONFLICT (url_hash) DO NOTHING` は
 * もう要らない。
 *
 * `down` は `RESTART IDENTITY` 付きで truncate する。BIGSERIAL の `id` の
 * カウンタが巻き戻るので、往復のテストにおいて、作りたての `CREATE TABLE` と
 * 区別が付かない状態に戻る。
 */
import type { Kysely } from "kysely";
import { sql } from "kysely";
import type { Database } from "../database.js";

export const up = async (db: Kysely<Database>): Promise<void> => {
  await db
    .insertInto("captureTargets")
    .values([
      // `orgId` は列の既定 ("default") に任せない。`.env.example` が
      // `WAGGLE_DEV_ORGANIZATIONS=acme` を配っていて、`pnpm run capture` は
      // **自分が属さない組織の URL を投げない**。既定のままだと、書いてある
      // とおりに setup した人が最初の取り込みで落ちる (実際に落ちた)。
      { url: "https://www.apple.com/", labels: ["Apple"], orgId: "acme" },
      { url: "https://www.microsoft.com/", labels: ["Microsoft"], orgId: "acme" },
      { url: "https://www.cloudflare.com/", labels: ["Cloudflare"], orgId: "acme" },
      { url: "https://www.ana.co.jp/group/", labels: ["9202", "ANAHoldings"], orgId: "acme" },
      { url: "https://www.datadoghq.com/", labels: ["Datadog"], orgId: "acme" },
    ])
    .execute();
};

export const down = async (db: Kysely<Database>): Promise<void> => {
  await sql`TRUNCATE TABLE capture_targets RESTART IDENTITY`.execute(db);
};
