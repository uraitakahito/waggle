/**
 * OpenFGA の client を作る。outbox の worker が頼っているエラー判定もここに置く。
 */
import { CredentialsMethod, OpenFgaClient } from "@openfga/sdk";
import type { FgaConfig } from "../config/env.js";

export const createFgaClient = (config: FgaConfig): OpenFgaClient =>
  new OpenFgaClient({
    apiUrl: config.apiUrl,
    storeId: config.storeId,
    // 意図して固定している —— `FgaConfig.modelId` を見ること。
    authorizationModelId: config.modelId,
    credentials: {
      method: CredentialsMethod.ApiToken,
      config: { token: config.apiToken },
    },
  });

/**
 * 失敗した書き込みが「ストアが既にその状態である」だけを意味するかどうか。
 *
 * 配送は at-least-once なので、worker は確信の持てない行を送り直す。そのとき
 * 重複した書き込みを失敗として扱ってはならない —— さもないと 1 行が詰まり、その
 * 後ろが全部止まる。
 *
 * OpenFGA v1.10.2 で実測。code はいずれも `write_failed_due_to_invalid_input`:
 *
 *   既存の tuple を書く   → "cannot write a tuple which already exists"
 *   無い tuple を消す     → "cannot delete a tuple which does not exist"
 *
 * 対照として、未知の relation は `validation_error` を返す —— つまり code だけでも
 * 本当のモデルの誤りとは区別が付く。それでも message まで見ているのは、
 * `write_failed_due_to_invalid_input` がこの 2 つだけを覆うとは文書化されていない
 * から。厳しすぎれば再試行 1 回で済むが、緩すぎると入らなかった tuple を捨てる
 * ことになり、欠けた tuple は誰かが不当に拒まれるまで目に見えない。
 */
export const isAlreadyInDesiredState = (cause: unknown): boolean => {
  if (typeof cause !== "object" || cause === null) return false;
  const err = cause as { responseData?: { code?: string }; message?: string };
  if (err.responseData?.code !== "write_failed_due_to_invalid_input") return false;
  const message = err.message ?? "";
  return message.includes("already exists") || message.includes("does not exist");
};
