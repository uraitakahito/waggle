/**
 * コードが読む環境変数と、`.env.example` が宣言している環境変数が一致している
 * ことを確かめる。
 *
 * **古い雛形は、雛形が無いより悪い。** 在ると「これで全部だ」と信じて使うので、
 * 足りないときに疑う先が残らない。雛形を置く以上、この検査は対で要る。
 *
 * 読み取りは 3 つの仕組みに散っている:
 *
 *   1. `src/config/` の required / optional / need (collectEnv が配るもの)
 *   2. commander の `.env()` —— `--help` にも出るので、ここは意図して残してある
 *   3. 素の `process.env[...]`
 *
 * **読み取り関数の名前が、そのままこの検査の契約になっている。** 1 の名前を
 * 増やしたり変えたりしたら PATTERNS も直すこと。直し忘れると「もう誰も読まない」
 * が大量に出る —— collectEnv を入れたときに実際にそうなった。
 *
 * しかも 1 は `env.ts` の外 (`config/identity.ts`) でも使われ、3 は `scripts/`
 * でも使われる。だから「`env.ts` を読めば分かる」は成り立たない ——
 * この検査を書く前に手で数えたときは、25 個のうち 5 個を落とした。
 *
 * 名前は必ずリテラルで書くこと。組み立てた名前はここに映らないので、黙って
 * 未文書になる。
 *
 * `pnpm run check` と CI の独立したステップの両方から走る。CI の check job は
 * `pnpm run check` を呼ばず個別のステップを並べているので、package.json に
 * 足すだけでは CI に入らない。
 */
import { readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// cwd に依存させない。scripts/ から走らせても repo の root から走らせても同じ
// 結果になること —— 同じ形の検査が cwd 依存で壊れた前例がある。
const ROOT = fileURLToPath(new URL("..", import.meta.url));

const SOURCE_DIRS = ["src", "scripts"];
const TEMPLATE = ".env.example";

const PATTERNS = [
  /\b(?:required|optional|need)\("([A-Z_0-9]+)"/g,
  /\.env\("([A-Z_0-9]+)"\)/g,
  /process\.env\["([A-Z_0-9]+)"\]/g,
];

const walk = (dir) =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? walk(path) : [path];
  });

/** name -> 最初に見つけたファイル。直す人には「どこで読まれているか」が要る。 */
const used = new Map();
for (const dir of SOURCE_DIRS) {
  for (const file of walk(resolve(ROOT, dir)).filter((f) => /\.(ts|mjs)$/.test(f))) {
    const source = readFileSync(file, "utf8");
    for (const pattern of PATTERNS) {
      for (const match of source.matchAll(pattern)) {
        if (!used.has(match[1])) used.set(match[1], relative(ROOT, file));
      }
    }
  }
}

// **コメント行も「宣言されている」と数える。** 任意の変数は既定値を見せるために
// コメントで置いてある —— 生の行にすると、雛形を写した瞬間に空文字がその既定値を
// 潰しうる。`#NAME=` と `NAME=` の両方を受ける。
const declared = new Set(
  readFileSync(resolve(ROOT, TEMPLATE), "utf8")
    .split("\n")
    .flatMap((line) => /^\s*#?\s*([A-Z_0-9]+)=/.exec(line)?.slice(1, 2) ?? []),
);

const problems = [];
for (const [name, file] of used) {
  if (!declared.has(name)) {
    problems.push(`${TEMPLATE} に無い: ${name}  (${file} が読んでいる)`);
  }
}
// 片側だけ見ると雛形は増える一方になる。残骸が残っていると、読む人は「これも
// 要るのか」と埋めようとして、埋められずに止まる。抜けと同じくらい人を止める。
for (const name of declared) {
  if (!used.has(name)) {
    problems.push(`もう誰も読まない: ${name}  (${TEMPLATE} から消すこと)`);
  }
}

if (problems.length > 0) {
  console.error(`環境変数の一覧が ${TEMPLATE} とずれています:\n`);
  for (const problem of problems) console.error(`  ${problem}`);
  console.error(
    `\n${TEMPLATE} が .env の唯一の出どころです (setup.sh はこれを写すだけ)。` +
      "\n新しい変数を足したら、値の例と「なぜ要るか」も一緒に書くこと ——" +
      "\n名前だけでは何を入れるべきか分かりません。",
  );
  process.exit(1);
}

console.log(`✓ env check passed: ${String(used.size)} 個、すべて ${TEMPLATE} にある`);
