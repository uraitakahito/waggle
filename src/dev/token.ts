/**
 * 開発用の issuer からトークンを 1 つ取る CLI。**本番には無い。**
 *
 * `--subject` を変えるだけで「人が投げた場合」と「サービスが投げた場合」の
 * 両方を作れる。後者は、OpenFGA の owner tuple が `user:<サービス名>` になり
 * **人による削除ができなくなる**状態そのもの —— 認証を入れるより前に、
 * 認可の設計の穴をローカルで踏める。
 *
 * 本番でここに来るのは device flow か client credentials で、どちらもこれとは
 * 別物。本物の IdP が決まった日に、`issuer.ts` ごと消える。
 */
import { Command, Option } from "commander";

import { optional } from "../config/env.js";
import { DEFAULT_ISSUER_PORT } from "./issuer.js";

interface TokenOptions {
  subject: string;
  org: string[];
  expiresIn: string;
  issuer: string;
}

const program = new Command()
  .name("waggle oidc:token")
  .description("開発用の issuer からアクセストークンを 1 つ取る")
  .requiredOption("--subject <subject>", "JWT の sub。submitted_by と owner tuple になる")
  .addOption(
    new Option("--org <organization...>", "組織のクレーム。繰り返せる").default([] as string[]),
  )
  .option("--expires-in <duration>", "有効期限 (jose の綴り)", "1h")
  .option(
    "--issuer <url>",
    "開発用 issuer の URL",
    optional("WAGGLE_OIDC_ISSUER", `http://127.0.0.1:${String(DEFAULT_ISSUER_PORT)}`),
  );

export const main = async (argv: string[]): Promise<void> => {
  const opts = program.parse(argv).opts<TokenOptions>();

  const response = await fetch(`${opts.issuer}/token`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      subject: opts.subject,
      organizations: opts.org,
      expiresIn: opts.expiresIn,
    }),
  });

  if (!response.ok) {
    // issuer が動いていない場合がいちばん多いので、そう言う。
    program.error(
      `${opts.issuer} からトークンを取れなかった (${String(response.status)})。` +
        ` \`pnpm run oidc:issuer\` は動いているか?`,
    );
  }

  const json = (await response.json()) as { access_token?: string };
  const token = json.access_token;
  if (typeof token !== "string") {
    program.error("応答に access_token が無い");
  }
  // 標準出力にはトークンだけを出す。`TOKEN=$(pnpm run oidc:token ...)` で使えるように。
  process.stdout.write(`${token}\n`);
};

await main(process.argv);
