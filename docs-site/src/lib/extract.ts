/**
 * コードから「事実」を取り出す唯一の入口。
 *
 * ドキュメントに書かれた事実のうち、waggle のソースやピン留め設定を写しただけの
 * ものは、ここを経由して実物から読む。手書きでコピーするとコード側の変更に
 * 追随せず、しかも間違いに誰も気付かない（実際、docs/architecture.md は
 * ピンを持つ箇所を「3 箇所」と書いていたが実際は 4 箇所だった）。
 *
 * BrowserHive 側の事実は対象外。あちらの docs へリンクする（DRY）。
 *
 * browserhive の同名ファイルは ts-morph で `@glossary` も抽出するが、waggle には
 * 用語集にすべき語彙がないので `#region` とピン検査だけを持つ。依存はゼロ。
 */
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
 * BrowserHive のピン留めバージョンを、それを持つ 4 ファイルすべてから読む。
 * 1 つでも食い違えば throw する（= astro build が落ちる）。
 *
 * ドキュメントはこの戻り値だけを表示するので、版数表記が実体とずれること自体が
 * 起こらない。同時に「上げ忘れたファイルがある」状態も検出できる — 4 箇所を手で
 * 直す運用は現に一度失敗しかけている。
 */
export function browserhivePin(): string {
  const found: Record<string, string | undefined> = {
    "package.json": /refs\/tags\/([^/]+)\//.exec(read("package.json"))?.[1],
    "setup.sh": /BROWSERHIVE_VERSION="([^"]+)"/.exec(read("setup.sh"))?.[1],
    "compose.dev.yaml": /BROWSERHIVE_REF:-([^}]+)\}/.exec(read("compose.dev.yaml"))?.[1],
    "compose.prod.yaml": /BROWSERHIVE_REF:-([^}]+)\}/.exec(read("compose.prod.yaml"))?.[1],
  };

  const values = [...new Set(Object.values(found))];
  if (values.length !== 1 || values[0] === undefined) {
    throw new Error(
      `BrowserHive pin disagrees across the files that carry it:\n${JSON.stringify(found, null, 2)}`,
    );
  }
  return values[0];
}
