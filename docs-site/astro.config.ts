import { defineConfig } from "astro/config";
import starlight from "@astrojs/starlight";
import mermaid from "astro-mermaid";
import { satteri } from "@astrojs/markdown-satteri";
import mdastCodeRegion from "./src/plugins/mdast-code-region";
import hastRebaseLinks from "./src/plugins/hast-rebase-links";

const BASE = "/waggle";

// BrowserHive の公開ドキュメント。waggle は BrowserHive の挙動を一切書かず、
// ここへリンクする(DRY: 一次情報は向こうにしかない)。絶対 URL なのは意図的で、
// root-relative にすると Starlight が日本語ページ上で /ja/ を注入し 404 になる。

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
            {
              label: "Databases",
              translations: { ja: "データベース" },
              items: [
                { label: "Overview", translations: { ja: "全体像" }, slug: "databases" },
                { label: "urls", slug: "databases/urls" },
                { label: "capture_submissions", slug: "databases/capture-submissions" },
                { label: "archives", slug: "databases/archives" },
                { label: "fga_outbox", slug: "databases/fga-outbox" },
                { label: "tuple", slug: "databases/tuple" },
              ],
            },
          ],
        },
        // 一次情報 (BrowserHive の docs) への出口はここに置いていた。あちらが
        // web への公開をやめ、チェックアウトで `pnpm run docs:local` を実行して
        // 読む形になったので、リンクとして張れるものが無くなった。
      ],
    }),
  ],
  // ```ts file="src/…#region" を実ソースに差し替える(コード片を live 化)
  markdown: {
    // Astro 7.2 の既定プロセッサ。legacy の remarkPlugins/rehypePlugins は
    // @astrojs/markdown-remark(unified) を要求するので、そちらは使わない。
    processor: satteri({
      mdastPlugins: [mdastCodeRegion],
      hastPlugins: [hastRebaseLinks],
    }),
  },
});
