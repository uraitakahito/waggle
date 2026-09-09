/**
 * クロールの範囲を決める。
 *
 * この repo に URL を扱う道具は無かったので、ここが最初の 1 つになる。
 *
 * ## 判定は種に対して行う
 *
 * 「リンク元のページと同じか」ではなく「**種と同じか**」で見る。前者だと、範囲の端に
 * あるページから外へ 1 歩出た瞬間に、そこが新しい中心になって際限なく広がる。
 * 種を基準にすれば、範囲はクロールを頼んだ時点で決まり、後から動かない。
 *
 * ## 正規化はフラグメントを落とすだけ
 *
 * `#section` は同じ資源の中の位置で、別の資源ではない。落とさないと同じページを
 * 何度も取る。
 *
 * それ以上はやらない。クエリの並べ替えも、末尾スラッシュの統一も、`index.html` の
 * 除去もしない —— どれも「同じ資源のはず」という**こちらの想定**であって、相手の
 * サーバがそう扱う保証は無い。並べ替えたクエリが別のページを返すサイトは実在する。
 * 取りこぼしより、取り違えのほうが悪い。
 */

/** どこまでを同じ範囲と見なすか。`database.ts` の `CrawlScope` と同じ綴り。 */
export type Scope = "same-origin" | "same-host";

export interface ParsedUrl {
  /** フラグメントを落とした、比較と保存に使う形。 */
  normalized: string;
  host: string;
  origin: string;
}

/**
 * http(s) の URL として読む。読めなければ `undefined`。
 *
 * scheme を絞るのは、辿る先が `mailto:` や `javascript:` になりうるから。
 * BrowserHive の links 抽出も同じ絞り込みをしているが、ここでも見る —— この関数は
 * 抽出結果以外 (種、将来の別経路) にも使うので、片方に頼らない。
 */
export const parseHttpUrl = (raw: string): ParsedUrl | undefined => {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return undefined;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return undefined;

  url.hash = "";
  return { normalized: url.toString(), host: url.host, origin: url.origin };
};

/**
 * `candidate` が `seed` の範囲に入るか。
 *
 * `same-origin` は scheme+host+port が一致すること。`http://` と `https://` は別の
 * origin なので、混在するサイトでは `same-host` を選ぶことになる。
 */
export const inScope = (candidate: ParsedUrl, seed: ParsedUrl, scope: Scope): boolean =>
  scope === "same-host" ? candidate.host === seed.host : candidate.origin === seed.origin;

/** BrowserHive の `.links.json` の 1 件。`rel` はそのまま渡ってくる。 */
export interface DiscoveredLink {
  href: string;
  rel?: string | null;
}

export interface AcceptedLink {
  url: string;
  host: string;
}

/**
 * 見つけたリンクから、次に取るものを選ぶ。
 *
 * 落とすもの: http(s) でないもの、範囲外、`rel="nofollow"`、そしてこの呼び出しの中での
 * 重複。**クロール全体での重複は落とさない** —— それは `crawl_pages` の unique index の
 * 仕事で、2 か所で判断すると食い違ったときにどちらが正しいのか言えなくなる。
 *
 * `rel` は空白区切りの語の並びなので、部分一致ではなく語として見る
 * (`nofollowme` のような値を誤って落とさないため)。
 */
export const acceptLinks = (
  links: readonly DiscoveredLink[],
  seed: ParsedUrl,
  scope: Scope,
): AcceptedLink[] => {
  const seen = new Set<string>();
  const accepted: AcceptedLink[] = [];

  for (const link of links) {
    const rel = (link.rel ?? "").toLowerCase().split(/\s+/);
    if (rel.includes("nofollow")) continue;

    const parsed = parseHttpUrl(link.href);
    if (parsed === undefined) continue;
    if (!inScope(parsed, seed, scope)) continue;
    if (seen.has(parsed.normalized)) continue;

    seen.add(parsed.normalized);
    accepted.push({ url: parsed.normalized, host: parsed.host });
  }

  return accepted;
};
