import { defineConfig } from "astro/config";
import starlight from "@astrojs/starlight";
import mermaid from "astro-mermaid";
import remarkCodeRegion from "./src/plugins/remark-code-region";

const BASE = "/waggle";

// BrowserHive の公開ドキュメント。waggle は BrowserHive の挙動を一切書かず、
// ここへリンクする(DRY: 一次情報は向こうにしかない)。絶対 URL なのは意図的で、
// root-relative にすると Starlight が日本語ページ上で /ja/ を注入し 404 になる。
const BH = "https://uraitakahito.github.io/browserhive";

// Rehype プラグイン: markdown 本文内の絶対ローカルリンク (/page/) に base を付与し、
// /ja/ 配下のページからのリンクには /ja ロケールも注入する。Starlight のサイドバーや
// ナビは slug 経由で base/locale-aware だが、MD/MDX 本文に書かれた [text](/page/) は
// 素通しになるため rehype 段で補正する。アセット(最終セグメントに拡張子を持つ href)は
// base のみ付与する。既に base-aware なリンクは二重付与しない。
function rehypeRebaseLinks() {
  return function (tree: any, file: any): void {
    const path: string = file?.path ?? file?.history?.[0] ?? "";
    const inJa = /[\\/]docs[\\/]ja[\\/]/.test(path);
    const walk = (node: any): void => {
      if (
        node.type === "element" &&
        node.tagName === "a" &&
        typeof node.properties?.href === "string"
      ) {
        const href: string = node.properties.href;
        if (
          href.startsWith("/") &&
          !href.startsWith("//") &&
          !href.startsWith(BASE + "/") &&
          href !== BASE
        ) {
          const lastSeg = href.split(/[?#]/)[0].split("/").pop() ?? "";
          const isAsset = lastSeg.includes(".");
          const locale =
            inJa && !isAsset && !href.startsWith("/ja/") && href !== "/ja" ? "/ja" : "";
          node.properties.href = BASE + locale + href;
        }
      }
      for (const child of node.children ?? []) walk(child);
    };
    walk(tree);
  };
}

// waggle ドキュメントサイト。英語(root)と日本語(/ja/)を最初から対で持つ。
// 対訳の欠落は scripts/check-doc-refs.mjs が検出する。
export default defineConfig({
  site: "https://uraitakahito.github.io",
  base: BASE,
  integrations: [
    // ```mermaid をクライアントサイドで描画。starlight より前に置く。
    mermaid({ theme: "neutral" }),
    starlight({
      title: "waggle Docs",
      customCss: ["./src/styles/tables.css"],
      defaultLocale: "root",
      locales: {
        root: { label: "English", lang: "en" },
        ja: { label: "日本語", lang: "ja" },
      },
      // 各項目に `ja` 訳を持たせる。Starlight はページを翻訳するが
      // ナビゲーションは翻訳しないので、これが無いと日本語ドキュメントは
      // 翻訳済みのページが英語の目次にぶら下がった状態になる。
      sidebar: [
        { label: "Quickstart", translations: { ja: "クイックスタート" }, slug: "quickstart" },
        {
          label: "Guides",
          translations: { ja: "ガイド" },
          items: [
            {
              label: "Development environment",
              translations: { ja: "開発環境" },
              slug: "development-environment",
            },
            { label: "URL source", translations: { ja: "URL ソース" }, slug: "url-source" },
            {
              label: "Capture options",
              translations: { ja: "キャプチャオプション" },
              slug: "capture-options",
            },
            {
              label: "Archive ledger",
              translations: { ja: "アーカイブ台帳" },
              slug: "archive-ledger",
            },
            {
              label: "Upgrading BrowserHive",
              translations: { ja: "BrowserHive の更新" },
              slug: "upgrading-browserhive",
            },
          ],
        },
        {
          label: "For developers",
          translations: { ja: "開発者向け" },
          items: [
            { label: "Architecture", translations: { ja: "アーキテクチャ" }, slug: "architecture" },
          ],
        },
        // 一次情報への出口。waggle が説明しないことは全部この先にある。
        // ラベルはサイトの名前なので訳さない。
        { label: "BrowserHive Docs ↗", translations: { ja: "BrowserHive Docs ↗" }, link: `${BH}/` },
        {
          label: "BrowserHive API ↗",
          translations: { ja: "BrowserHive API ↗" },
          link: `${BH}/api/`,
        },
      ],
    }),
  ],
  // ```ts file="src/…#region" を実ソースに差し替える(コード片を live 化)
  markdown: {
    remarkPlugins: [remarkCodeRegion],
    rehypePlugins: [rehypeRebaseLinks],
  },
});
