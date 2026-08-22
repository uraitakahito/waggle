/**
 * このリクエストを出しているのが誰か。
 *
 * ## これは継ぎ目であって、実装ではない
 *
 * 呼び出し元を認証することは、認可することとは別の問題で、しかもまだ選んでいない
 * identity provider に依存する。認可の層がそこから必要とするものは小さく安定して
 * いる —— subject と、その人が属する組織 —— ので、その形だけをここで固定し、
 * 裏の検証は他に触れずに差し替えられるようにしてある。
 *
 * 下の開発用 resolver は header を信じる。それが安全なのは、明示的に有効化しない
 * 限り動くことを拒み、起動時に大きな声でそう言うから。本物の IdP が来たら、JWT を
 * 検証する resolver を足して既定にすればよい。`routes.ts` は何も変わらない。
 *
 * ## なぜ組織はトークンから来るのか
 *
 * 所属は OpenFGA に保存しない。リクエストごとに contextual tuple として渡すので、
 * 組織への参加や離脱を認可ストアへ同期する必要が一度も生じない —— その点については
 * トークンが既に出どころだから。代償は、取り消しがトークンの失効を待つこと。
 * トークンを短命にすべき理由がそれ。
 */
import type { FastifyRequest } from "fastify";

export interface Identity {
  subject: string;
  organizations: string[];
}

export type IdentityResolver = (request: FastifyRequest) => Promise<Identity | undefined>;

/**
 * ローカル開発用の、header を信じる resolver。
 *
 * `X-Waggle-Subject` と `X-Waggle-Organizations` (カンマ区切り) をそのまま受け取る
 * —— そのポートに届く者は誰にでもなれる。`WAGGLE_DEV_IDENTITY=1` のときしか
 * 到達できない。
 */
export const devIdentityResolver: IdentityResolver = (request) => {
  const subject = request.headers["x-waggle-subject"];
  if (typeof subject !== "string" || subject === "") return Promise.resolve(undefined);

  const orgHeader = request.headers["x-waggle-organizations"];
  const organizations =
    typeof orgHeader === "string"
      ? orgHeader
          .split(",")
          .map((org) => org.trim())
          .filter((org) => org !== "")
      : [];

  return Promise.resolve({ subject, organizations });
};

/** 全員を拒む。これが既定なので、設定していない配備から漏れることはない。 */
export const denyAllResolver: IdentityResolver = () => Promise.resolve(undefined);

export const resolveIdentityResolver = (): IdentityResolver =>
  process.env["WAGGLE_DEV_IDENTITY"] === "1" ? devIdentityResolver : denyAllResolver;
