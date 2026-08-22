/**
 * `src/rpc/generated/` が import するパッケージは、すべて production 依存で
 * なければならない。
 *
 * そこにある import を選ぶのは ts-proto であって、この repo を読む人ではない。
 * `@bufbuild/protobuf` が漏れたのはまさにそれが理由だった: npm が ts-proto 自身の
 * 木から hoist するので、開発中もテスト中も解決できてしまう。Dockerfile の
 * prod 依存だけの木からは ts-proto ごと消えるので、イメージは最初の import で
 * 落ちる —— `check` をいくら回しても届かない失敗。
 *
 * pnpm は既定で hoist しないので、同じ間違いは開発中に即エラーになる。それでも
 * この検査を残しているのは、検出が早まることと、runtime イメージが prod 依存だけで
 * 作られる事実は変わらないことの 2 つによる。
 *
 * 上流の `.proto` が変わって再生成すると新しい import が増えることがある
 * (well-known types が @bufbuild/protobuf をさらに引く) ので、固定の一覧ではなく
 * ファイルが実際に何を import しているかを見る。
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const GENERATED_DIR = "src/rpc/generated";

const walk = (dir) =>
  readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });

const { dependencies = {} } = JSON.parse(readFileSync("package.json", "utf8"));

/** `@scope/name/sub` -> `@scope/name`, `name/sub` -> `name`. Relative paths are skipped. */
const packageOf = (specifier) => {
  const parts = specifier.split("/");
  return specifier.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0];
};

const imported = new Map();
for (const file of walk(GENERATED_DIR).filter((f) => f.endsWith(".ts"))) {
  const source = readFileSync(file, "utf8");
  for (const match of source.matchAll(/from\s+"([^"]+)"/g)) {
    const specifier = match[1];
    if (specifier.startsWith(".") || specifier.startsWith("node:")) continue;
    const name = packageOf(specifier);
    if (!imported.has(name)) imported.set(name, file);
  }
}

const missing = [...imported].filter(([name]) => !(name in dependencies));
if (missing.length > 0) {
  console.error(`${GENERATED_DIR} imports packages that are not production dependencies:\n`);
  for (const [name, file] of missing) {
    console.error(`  ${name}  (first seen in ${file})`);
  }
  console.error(
    "\n`pnpm add <name>` で足すこと。devDependency では足りない: runtime イメージは\n" +
      "prod 依存だけを入れた層から作られる (Dockerfile の deps 段)。",
  );
  process.exit(1);
}

console.log(
  `✓ generated deps check passed: ${String(imported.size)} package(s), all in dependencies`,
);
