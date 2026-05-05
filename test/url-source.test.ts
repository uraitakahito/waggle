import { describe, expect, it, vi } from "vitest";
import type { Pool, QueryResult, QueryResultRow } from "pg";
import { loadUrls } from "../src/data/url-source.js";

interface UrlRow extends QueryResultRow {
  url: string;
  labels: string[];
}

const makeRow = (url: string, labels: string[]): UrlRow => ({ url, labels });

const makePool = (rows: UrlRow[]) => {
  const result: QueryResult<UrlRow> = {
    rows,
    command: "SELECT",
    rowCount: rows.length,
    oid: 0,
    fields: [],
  };
  const query = vi.fn().mockResolvedValue(result);
  const pool = { query } as unknown as Pool;
  return { pool, query };
};

describe("loadUrls", () => {
  it("maps rows to DataEntry preserving order", async () => {
    const { pool } = makePool([
      makeRow("https://www.apple.com/", ["Apple"]),
      makeRow("https://www.ana.co.jp/group/", ["9202", "ANAHoldings"]),
    ]);
    const entries = await loadUrls(pool, {});
    expect(entries).toEqual([
      { url: "https://www.apple.com/", labels: ["Apple"] },
      { url: "https://www.ana.co.jp/group/", labels: ["9202", "ANAHoldings"] },
    ]);
  });

  it("issues an unparameterised SELECT when no limit is given", async () => {
    const { pool, query } = makePool([]);
    await loadUrls(pool, {});
    expect(query).toHaveBeenCalledWith(
      "SELECT url, labels FROM urls WHERE enabled ORDER BY id ASC",
      [],
    );
  });

  it("pushes the limit down into SQL when set", async () => {
    const { pool, query } = makePool([]);
    await loadUrls(pool, { limit: 3 });
    expect(query).toHaveBeenCalledWith(
      "SELECT url, labels FROM urls WHERE enabled ORDER BY id ASC LIMIT $1",
      [3],
    );
  });

  it("returns empty array when no rows match", async () => {
    const { pool } = makePool([]);
    const entries = await loadUrls(pool, { limit: 10 });
    expect(entries).toEqual([]);
  });
});
