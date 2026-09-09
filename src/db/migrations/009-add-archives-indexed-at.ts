/**
 * 009-add-archives-indexed-at
 *
 * そのアーカイブを全文検索の索引に載せたか。**載せた時刻だけを持ち、中身は持たない。**
 *
 * ## なぜ outbox ではないのか
 *
 * `003` の `fga_outbox` は「アプリのトランザクションに載せられない書き込み」を
 * 抱えるための表で、同じ形がここでも要りそうに見える。要らない。
 *
 * あちらが payload を保存しているのは、OpenFGA へ送る tuple が **その瞬間にしか
 * 無い情報**だから —— 所属は保存しない設計なので、後から組み直せない。索引は違う。
 * 何を索引すべきかは `archives` の行から引け、中身は S3 の WACZ にある。
 * **導けるものを保存している**ことになる。
 *
 * そして本文は大きい。BrowserHive の `pages.jsonl` は 1 ページあたり最大
 * 100 万文字 (日本語で約 3MB)。at-least-once の queue は配送できるまで行が残るので、
 * OpenSearch が落ちている間ずっと Postgres がそれを抱えることになる。
 *
 * ## 列 1 つで足りる理由
 *
 * 必要なのは「まだ載せていない」を引けることだけ:
 *
 *   索引すべきもの    WHERE indexed_at IS NULL
 *   全部作り直す      UPDATE archives SET indexed_at = NULL
 *
 * 後者が 1 文で書けることには意味がある。解析器 (いまは組み込みの `cjk`) や
 * mapping を変えると再構築が要るが、その判断が安くなる —— kuromoji へ移る決断を
 * 後回しにできるのはこのため。
 *
 * ## NULL の意味は 1 つだけ
 *
 * `005` の `signed` と違い、ここに 3 状態は無い。NULL は「まだ」であって
 * 「求めていない」ではない。索引を持たない配備では単に誰も読まない列になる。
 *
 * 失敗を列に残すことも考えたが、置いていない —— 失敗した行は NULL のままなので
 * 次の周回が拾う。理由が要るなら log に出す。**表に理由を溜めると、それを掃除する
 * 仕事が生まれる。**
 */
import type { Kysely } from "kysely";
import { sql } from "kysely";

export const up = async (db: Kysely<unknown>): Promise<void> => {
  await db.schema.alterTable("archives").addColumn("indexed_at", "timestamptz").execute();

  // 探すのは常に「まだ載せていない行」なので、部分 index で足りる。索引が追い付いて
  // いれば、この index はほぼ空のまま —— 全体に張ると、載せ終えた行まで抱えることになる。
  await sql`
    CREATE INDEX archives_unindexed_idx ON archives (id) WHERE indexed_at IS NULL
  `.execute(db);
};

export const down = async (db: Kysely<unknown>): Promise<void> => {
  await db.schema.alterTable("archives").dropColumn("indexed_at").execute();
};
