/**
 * 001-sample-urls
 *
 * ローカルの開発と本番構成の smoke test が使うサンプルの URL。
 *
 * 冪等性は `kysely_seed` の台帳が与える —— 一度当たったファイルを migrator が
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
