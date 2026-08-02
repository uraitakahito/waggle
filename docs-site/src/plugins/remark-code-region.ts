// ```ts file="src/…#region" のコードフェンスを、現在の実ソース片に置換する
// remark プラグイン。doc にコードを手書きコピーせず常に最新を取り込む。
import { sourceRegion } from "../lib/extract";

interface MdNode {
  type: string;
  meta?: string | null;
  value?: string;
  children?: MdNode[];
}

const walk = (node: MdNode): void => {
  if (node.type === "code" && typeof node.meta === "string") {
    const m = /file="([^"#]+)#([^"]+)"/.exec(node.meta);
    // region 欠落なら throw。ただしビルドが止まるかは拡張子次第で、.mdx なら
    // vite が拾って落ちる一方、.md は Starlight の docs loader が捕まえて
    // ログを出すだけで exit 0 になる（実測）。region を参照しているページは
    // 全部 .md なので、非ゼロで落ちるのは check-doc-refs.mjs の方。
    if (m) node.value = sourceRegion(m[1], m[2]);
  }
  node.children?.forEach(walk);
};

export default function remarkCodeRegion() {
  return (tree: MdNode): void => walk(tree);
}
