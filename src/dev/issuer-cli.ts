/**
 * 開発用 issuer の entry point。`pnpm run oidc:issuer` が呼ぶ。
 *
 * 中身は `issuer.ts` に在る —— こちらは起動するだけ。分けてあるのは、
 * 試験が `buildDevIssuer` を待受なしで組み立てられるようにするため。
 */
import { startDevIssuer } from "./issuer.js";

await startDevIssuer();
