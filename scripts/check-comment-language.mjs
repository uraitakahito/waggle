/**
 * ソース中に残っている「英語の散文コメント行」を数える。
 *
 * 移行中は残量を数える道具で、移行が済んだ後は英語のコメントが戻らないことを
 * 見張る。`npm run lint:comments` として CI のステップに入っている。対象は
 * package.json の lint:comments を見ること。
 *
 *   npm run lint:comments                                  # CI と同じ範囲を見る
 *   node scripts/check-comment-language.mjs src --lines     # 残っている行も出す
 *
 * 英語行が 1 つでもあれば終了コード 1。
 *
 * browserhive から移植した。除外規則は向こうの移行で得たもので、作り直すと
 * その学習をやり直すことになる。
 *
 * 数えないもの
 * ------------
 * 日本語が入りようのない行は数から外す。外さないと「英語 0 行」に到達できない。
 *
 *   - JSDoc のタグ単体 (`@param`、`@returns` …) と `#region` などのマーカー
 *   - `eslint-disable` / `@ts-` などのディレクティブ
 *   - 見出しの下線・区切り、URL 単体、`ラベル : 数式` の行、CSS セレクタ
 *   - 語が 1 つだけの markdown 見出し (`## --wacz` のようなフラグ名やパス)。
 *     語が 2 つ以上あれば訳す対象なので数える。browserhive 版から広げて、数字で
 *     始まる識別子 (`002-create-archives` のような migration 名) も含めている
 *   - 行コメントに現れる製品名などの固有名詞ラベル (`// OpenFGA Playground`)。
 *     JSDoc 冒頭の見出しは訳す対象なので、ここには含めない
 *   - コメント内の ``` フェンスで囲われた中身 (SQL や JSON の実例)。フェンス自体も含む
 *   - markdown の表の行 (`|` で始まり `|` で終わる)
 *
 * 走査しないもの
 * --------------
 *   - `src/rpc/generated` —— `buf generate` の生成物。次の生成で消えるので訳して
 *     も意味が無い。直すなら上流の .proto のほう(そちらは既に日本語)
 *   - `proto/` —— `npm run proto:sync` が上流から cp してくる複製。訳すと次の
 *     sync で消える
 *   - 設定ファイル (tsconfig.json / Dockerfile / docker-compose.yml など)。
 *     browserhive も英語のままにしている領域で、そこに揃えている
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const JA = /[぀-ヿ一-鿿]/;

const STRUCTURAL =
  /^(@\w+\b[^\s]*\s*$|@(param|returns?|throws|see|example|template|typeParam|glossary|category|module|packageDocumentation|internal|deprecated|remarks)\b|#region\b|#endregion\b|eslint-|@ts-|prettier-|c8 |v8 )/;

const NON_PROSE =
  /^([-=~*_]{3,}$|https?:\/\/\S+|[A-Za-z0-9_$.]+\s*[:=]\s*\S|[(){}[\]<>|&+*/%!?:;,.=-]+$|`[^`]*`$|[A-Za-z0-9][A-Za-z0-9_-]*$|::?[\w-]+$|[\w /()-]+:\s*[\d(].*$|[-*>]+\s*\S+$|\|.*\|$|#{1,6}\s+\S+$)/;

// 行コメントに現れる製品名などの固有名詞ラベル。JSDoc 冒頭の見出しは訳す対象なので
// ここには含めない (`//` で始まる行だけに適用する)。
const PROPER_NOUN_LABEL = /^([A-Z][A-Za-z0-9.-]*)(\s[A-Z][A-Za-z0-9.-]*){1,3}$/;

const SKIP = /node_modules|dist|generated|\.astro|graphify-out|\.upstream/;

const walk = (dir, out = []) => {
  // ファイルを直接渡せると、1 ファイルだけ確かめたいときに楽
  if (statSync(dir).isFile()) return /\.(ts|tsx|mts|mjs)$/.test(dir) ? [dir] : [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (SKIP.test(p)) continue;
    if (e.isDirectory()) walk(p, out);
    else if (/\.(ts|tsx|mts|mjs)$/.test(e.name)) out.push(p);
  }
  return out;
};

export const scanFile = (file) => {
  let inBlock = false;
  // コメント内の ``` フェンス。中身は実例であって散文ではない。
  let inFence = false;
  let en = 0;
  let ja = 0;
  const lines = [];
  readFileSync(file, "utf8")
    .split("\n")
    .forEach((l, i) => {
      const t = l.trim();
      let isComment = false;
      let isLineComment = false;
      if (inBlock) {
        isComment = true;
        if (t.includes("*/")) inBlock = false;
      } else if (t.startsWith("/*")) {
        isComment = true;
        if (!t.includes("*/")) inBlock = true;
      } else if (t.startsWith("//")) {
        isComment = true;
        isLineComment = true;
      }
      if (!isComment) return;
      const body = t
        .replace(/^[/*\s]+/, "")
        .replace(/\*\/$/, "")
        .trim();
      if (body.startsWith("```")) {
        inFence = !inFence;
        return;
      }
      if (inFence) return;
      if (!body || STRUCTURAL.test(body) || NON_PROSE.test(body)) return;
      if (isLineComment && PROPER_NOUN_LABEL.test(body)) return;
      if (JA.test(body)) ja++;
      else {
        en++;
        lines.push({ n: i + 1, body });
      }
    });
  return { en, ja, lines };
};

const roots = process.argv.slice(2).filter((a) => !a.startsWith("--"));
if (roots.length === 0) {
  console.error("usage: node scripts/check-comment-language.mjs <dir…> [--lines]");
  process.exit(2);
}
const showLines = process.argv.includes("--lines");

let totalEn = 0;
let totalJa = 0;
const rows = [];
for (const root of roots) {
  for (const file of walk(root)) {
    const s = scanFile(file);
    totalEn += s.en;
    totalJa += s.ja;
    if (s.en) rows.push({ file, ...s });
  }
}
rows.sort((a, b) => b.en - a.en);
for (const r of rows) {
  console.log(`${String(r.en).padStart(4)} 英 / ${String(r.ja).padStart(4)} 日   ${r.file}`);
  if (showLines) {
    for (const l of r.lines)
      console.log(`       ${String(l.n).padStart(4)}: ${l.body.slice(0, 96)}`);
  }
}
console.log(`── 英 ${totalEn} 行 / 日 ${totalJa} 行   残ファイル ${rows.length} 本`);
process.exitCode = totalEn > 0 ? 1 : 0;
