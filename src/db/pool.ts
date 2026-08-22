/**
 * Postgres の pool を作る。
 *
 * pool はプロセスに 1 つ。pool のエラー (待機中の client の失敗、貸し出し中の接続を
 * 切るネットワークの瞬断) は、プロセスを落とさず logger に出す —— pg の pool は
 * 次の貸し出しで接続を張り直す。
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
 * 落とすのは password 要素だけ。ユーザ名・host・port・DB 名は残るので、
 * ログから接続先を読み取れる。URL として解析できない文字列 (host:port 形式など)
 * は、そのまま返す。
 */
export const maskPassword = (url: string): string => {
  try {
    const parsed = new URL(url);
    if (parsed.password) parsed.password = "***";
    return parsed.toString();
  } catch {
    return url;
  }
};
