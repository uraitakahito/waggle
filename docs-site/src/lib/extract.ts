/**
 * コードから「事実」を取り出す唯一の入口。
 *
 * ドキュメントに書かれた事実のうち、waggle のソースやピン留め設定を写しただけの
 * ものは、ここを経由して実物から読む。手書きでコピーするとコード側の変更に
 * 追随せず、しかも間違いに誰も気付かない。
 *
 * BrowserHive 側の事実は対象外。あちらの docs へリンクする（DRY）。
 *
 * browserhive の同名ファイルは ts-morph で `@glossary` も抽出するが、waggle には
 * 用語集にすべき語彙がないので `#region` とピン検査だけを持つ。依存はゼロ。
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// waggle ルート。docs-site は waggle 直下にあり、astro dev/build は docs-site を
// cwd に実行されるので、その親がリポジトリルート。
// ※ import.meta.url は astro ビルド後の dist パスになるため使えない。
const ROOT = resolve(process.cwd(), "..");

const read = (rel: string): string => readFileSync(resolve(ROOT, rel), "utf8");

/**
 * `// #region <name>` … `// #endregion` で囲まれた実ソース片を返す。
 * region が見つからなければ throw = astro build が落ちる。
 */
export function sourceRegion(file: string, region: string): string {
  const re = new RegExp(String.raw`//\s*#region\s+${region}\b([\s\S]*?)//\s*#endregion`);
  const m = re.exec(read(file));
  if (!m) throw new Error(`region '${region}' not found in ${file}`);
  return m[1].replace(/^\n/, "").replace(/\s+$/, "");
}

/**
 * The BrowserHive version the `.upstream/browserhive` submodule points at.
 *
 * There used to be four copies of this string — the openapi:sync URL, setup.sh,
 * and both compose files — and a check here that they agreed, because a bump
 * had to edit all four by hand. The submodule replaced all of them, so there is
 * nothing left to disagree: this reads the one pointer and reports it.
 *
 * `git describe --tags` gives the tag name when the submodule sits exactly on a
 * tag (`1.6.0`) and a descriptor when it does not (`1.6.0-3-gabc1234`) — so the
 * docs show, accurately, that the pin has drifted off a release. An
 * uninitialised submodule throws, which fails the build.
 */
export function browserhivePin(): string {
  try {
    return execFileSync("git", ["-C", ".upstream/browserhive", "describe", "--tags"], {
      cwd: ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  } catch (cause) {
    throw new Error(
      "cannot read the BrowserHive pin from .upstream/browserhive — " +
        "run `git submodule update --init --recursive`",
      { cause },
    );
  }
}
