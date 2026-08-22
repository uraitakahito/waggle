/**
 * docs-site/ の Starlight のドキュメントが嘘をつかないことを確かめる。
 *
 * `astro build` が自力で捕まえるずれは 1 種類だけ: .upstream/browserhive の
 * submodule を初期化していないと、描画中に docs-site/src/lib/extract.ts から
 * throw する。固定した版を読んでいるのが .mdx のページなので、こちらはビルドが
 * 落ちる。残りはこのスクリプトの仕事:
 *
 *   1. 訳の欠落 —— 日本語版の無い英語ページ、あるいは英語の原文が無い日本語
 *      ページ。Starlight はページが無いと黙って英語に落とすので、半分だけ訳した
 *      サイトも緑でビルドでき、読み手が違う言語に着地するまで誰も気づかない。
 *   2. 壊れた `#region` の抜粋。ビルドが覆っていると思ってはいけない: region が
 *      無いと "Failed to parse Markdown file" とログに出るのに、`astro build` は
 *      全ページをビルドしたと報告して 0 で終わる (キャッシュを消してから 2 度実測)。
 *      ビルドに任せると、ドキュメントは空のコードフェンスのまま出てしまう。上の
 *      固定版と違う理由は拡張子 —— .mdx からの throw は vite を通って表に出るが、
 *      .md からのものは Starlight の docs loader が捕まえる —— で、ここで
 *      `#region` を参照しているページはどれも .md。
 *   3. 死んだソースのパス —— コードスパンに書かれた `src/….ts` のうち、その後
 *      名前が変わったか消えたもの。
 *
 * 訳について見るのはページの **存在** だけで、構造は一切見ない。両方の言語に同じ
 * 見出しを強いると日本語が悪くなる。ページの歩調を合わせるのは人の仕事で、
 * ページが消えないようにするのがこちらの仕事。
 *
 * `pnpm run site:check` (ビルド + このスクリプト) から走る。問題の一覧を出して 1 で
 * 終わるので、CI が PR を落とす。
 */
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, resolve, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const DOCS = resolve(ROOT, "docs-site/src/content/docs");
const JA = join(DOCS, "ja");

const isPage = (name) => /\.mdx?$/.test(name);
const pagesIn = (dir) =>
  readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && isPage(entry.name))
    .map((entry) => entry.name);

const problems = [];

// ─── 1. 英語 ↔ 日本語のページの対応 ────────────────────────────────────────
const en = pagesIn(DOCS);
const ja = new Set(pagesIn(JA));

for (const page of en) {
  if (!ja.has(page)) {
    problems.push(`ja/${page} is missing (English page has no Japanese counterpart)`);
  }
}
for (const page of ja) {
  if (!en.includes(page)) {
    problems.push(`${page} is missing (orphan Japanese page with no English original)`);
  }
}

// ─── 2. コードスパンに書かれたソースのパス ─────────────────────────────────
const walk = (dir) =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const p = join(dir, entry.name);
    return entry.isDirectory() ? walk(p) : [p];
  });

for (const file of walk(DOCS).filter((f) => isPage(f))) {
  const text = readFileSync(file, "utf8");
  const rel = relative(ROOT, file);

  for (const [, path] of text.matchAll(/`(src\/[A-Za-z0-9_\-/]+\.ts)`/g)) {
    if (!existsSync(resolve(ROOT, path))) {
      problems.push(`${rel}: \`${path}\` does not exist (renamed or moved?)`);
    }
  }

  // ```ts file="src/…#region" —— 差し込まれる抜粋。
  //
  // ビルドに任せずここで見ているのは、`astro build` がこれで落ちないから: region が
  // 無いと "Failed to parse Markdown file" とログに出るのに、ビルドは全ページを
  // ビルドしたと報告して 0 で終わる。ビルドに頼ると、ドキュメントが黙って空の
  // コードフェンスを出すことになる。
  for (const [, path, region] of text.matchAll(/file="([^"#]+)#([^"]+)"/g)) {
    const abs = resolve(ROOT, path);
    if (!existsSync(abs)) {
      problems.push(`${rel}: file="${path}" does not exist`);
      continue;
    }
    const source = readFileSync(abs, "utf8");
    // 名前は行末まで続いていなければならない。extract.ts と同じ規則。`\b` では
    // 足りない: `s` と `-` の間に単語の境界が在るので、`urls-columns` を求めると
    // `#region urls-columns-v2` という印にも当たってしまう —— そして非 0 で終わる
    // のはこの検査だけなので、ここが緩いとずれがそのまま出荷される。
    const re = new RegExp(
      String.raw`//\s*#region\s+${region}[ \t]*\r?$[\s\S]*?//\s*#endregion`,
      "m",
    );
    if (!re.test(source)) {
      problems.push(
        `${rel}: region "${region}" not found in ${path} (renamed, removed, or missing #endregion?)`,
      );
    }
  }
}

// ─── 報告 ──────────────────────────────────────────────────────────────────
if (problems.length > 0) {
  console.error(`✗ doc-ref check failed (${problems.length} problem(s)):`);
  for (const p of problems) console.error(`  - ${p}`);
  console.error(
    "\nDocs reference something that no longer matches the repository, or a\n" +
      "page exists in only one language. Fix the doc or restore what it points at.",
  );
  process.exit(1);
}

console.log(
  `✓ doc-ref check passed: ${String(en.length)} pages in English and Japanese, all source paths resolve`,
);
