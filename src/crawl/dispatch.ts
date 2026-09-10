/**
 * クロールを Windmill へ渡す。
 *
 * waggle は上流に居て、実行そのものは持たない。ここは「頼んだ」を伝えるだけの薄い層。
 *
 * ## なぜ webhook なのか
 *
 * Windmill の flow は path で webhook を持っていて、token 付きの POST 1 回で起動できる。
 * waggle 側に Windmill の client を抱えずに済むので、依存はこの URL と token だけになる。
 *
 * ## 設定していない配備では口ごと出さない
 *
 * クロールは後から足した能力なので、URL と token を **必須にはしない** ——
 * 必須にすると、クロールを使わない配備まで起動しなくなる。設定が無ければ
 * `undefined` を返し、呼ぶ側は route を登録しない。
 *
 * ただし **片方だけ設定されているのは拒む**。半端な設定は「動くはずなのに 401 が返る」
 * という形で、頼んだ後にしか気づけない失敗になる。両方か、どちらも無いか。
 *
 * ## 失敗したら
 *
 * 投げられなければクロールは始まらないので、`crawls` の行は `failed` で締める
 * (呼ぶ側でそうしている)。**黙って `running` のまま置かない** —— 部分 unique index が
 * 効いているので、締め忘れた行は次のクロールを永久に塞ぐ。
 */
import { optional } from "../config/env.js";
import type { CrawlDispatcher, DispatchedCrawl } from "../api/crawls.js";

const DEFAULT_TIMEOUT_MS = 10_000;

/**
 * 設定を読んで dispatcher を作る。設定が無ければ `undefined`。
 *
 * **起動時に読む。** クロールを頼まれた瞬間に「設定がありません」と言うのでは遅い ——
 * そのときには行が既に立っていて、締める処理が要る。
 */
export const createWindmillDispatcher = (): CrawlDispatcher | undefined => {
  const url = optional("WAGGLE_CRAWL_WEBHOOK_URL", "");
  const token = optional("WAGGLE_CRAWL_WEBHOOK_TOKEN", "");

  if (url === "" && token === "") return undefined;
  if (url === "" || token === "") {
    throw new Error(
      "WAGGLE_CRAWL_WEBHOOK_URL and WAGGLE_CRAWL_WEBHOOK_TOKEN must be set together " +
        "(one without the other cannot dispatch a crawl)",
    );
  }
  const timeoutMs = Number(optional("WAGGLE_CRAWL_WEBHOOK_TIMEOUT_MS", String(DEFAULT_TIMEOUT_MS)));

  return async (crawl: DispatchedCrawl): Promise<void> => {
    // **snake_case で送る。** Windmill の script は引数名がそのまま入力の契約で、
    // この repo の script は snake_case で書かれている。camelCase で送ると、
    // 引数は既定値のまま静かに走り、`host_parallelism` が null になって
    // 「u16 として読めない」で落ちる (実測)。
    //
    // `waggle_url` / `token` / `browserhive_target` は送らない —— flow の schema の
    // 既定値 (`$var:` 参照) が埋める。waggle は自分がコンテナからどう見えるかを
    // 知らないし、issuer の鍵も持っていないので、どちらもここでは決められない。
    const res = await fetch(url, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({
        crawl_id: crawl.crawlId,
        depth: crawl.depth,
        frontier: crawl.frontier,
        per_host_delay_ms: crawl.perHostDelayMs,
        host_parallelism: crawl.hostParallelism,
        // **形式と署名は必ず送る。** flow の schema の既定値は webhook 起動では
        // 埋まらないので、送らなければ `undefined` が届く。決めるのは waggle 側。
        capture_formats: crawl.captureFormats,
        signing: crawl.signing,
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) {
      // 本文まで読むのは、Windmill が理由を本文で返すから。status だけだと
      // 「404 でした」しか残らず、path の綴りなのか token なのかが分からない。
      const body = await res.text();
      throw new Error(`crawl webhook → ${String(res.status)} ${body.slice(0, 200)}`);
    }
  };
};
