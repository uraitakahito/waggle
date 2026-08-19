/**
 * Every package `src/rpc/generated/` imports must be a production dependency.
 *
 * The imports in there are chosen by ts-proto, not by anyone reading this repo,
 * and that is exactly how `@bufbuild/protobuf` got missed: npm hoists it out of
 * ts-proto's own tree, so it resolves during development and in every test.
 * `npm prune --omit=dev` in the Dockerfile then takes ts-proto away and the
 * hoisted copy with it, and the image fails at its first import — a failure no
 * amount of `npm run check` can reach.
 *
 * Regenerating after an upstream `.proto` change can introduce a new import
 * (well-known types pull in more of @bufbuild/protobuf), which is why this
 * looks at what the files actually import rather than at a fixed list.
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
    "\nAdd them with `npm i <name>`. A devDependency is not enough: the runtime\n" +
      "image is built with `npm prune --omit=dev`.",
  );
  process.exit(1);
}

console.log(
  `✓ generated deps check passed: ${String(imported.size)} package(s), all in dependencies`,
);
