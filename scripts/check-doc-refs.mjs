/**
 * Verify that the Starlight docs in docs-site/ stay honest.
 *
 * `astro build` catches one kind of drift on its own: a BrowserHive pin that
 * disagrees across the four files carrying it throws out of
 * docs-site/src/lib/extract.ts while rendering, and that does fail the build.
 * Everything else is this script's job:
 *
 *   1. Missing translations — an English page with no Japanese counterpart, or
 *      a Japanese page with no English original. Starlight silently falls back
 *      to English for a missing page, so a half-translated site builds green
 *      and nobody notices until a reader lands on the wrong language.
 *   2. Broken `#region` snippets. Do not assume the build covers these: a
 *      missing region logs "Failed to parse Markdown file" and `astro build`
 *      still reports every page built and exits 0 (measured, twice, on a cold
 *      cache). Left to the build, a doc would ship an empty code fence.
 *   3. Dead source paths — a `src/….ts` written in a code span that has since
 *      been renamed or deleted.
 *
 * Only page *existence* is checked for translations, never their structure.
 * Forcing the same headings on both languages makes for bad Japanese; keeping
 * the pages in step is a human job, keeping them from vanishing is this one.
 *
 * Run via `npm run site:check` (build + this script). Exits 1 with the list of
 * problems so CI fails the PR.
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

// ─── 1. English ↔ Japanese page parity ─────────────────────────────────────
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

// ─── 2. Source paths written in code spans ─────────────────────────────────
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

  // ```ts file="src/…#region" — the injected snippets.
  //
  // These are checked here rather than left to the build because `astro build`
  // does NOT fail on them: a missing region logs "Failed to parse Markdown
  // file" and the build still reports every page built and exits 0. Relying on
  // the build would mean a doc that silently ships an empty code fence.
  for (const [, path, region] of text.matchAll(/file="([^"#]+)#([^"]+)"/g)) {
    const abs = resolve(ROOT, path);
    if (!existsSync(abs)) {
      problems.push(`${rel}: file="${path}" does not exist`);
      continue;
    }
    const source = readFileSync(abs, "utf8");
    const re = new RegExp(String.raw`//\s*#region\s+${region}\b[\s\S]*?//\s*#endregion`);
    if (!re.test(source)) {
      problems.push(
        `${rel}: region "${region}" not found in ${path} (renamed, removed, or missing #endregion?)`,
      );
    }
  }
}

// ─── Report ────────────────────────────────────────────────────────────────
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
