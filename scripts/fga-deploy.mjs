#!/usr/bin/env node
/**
 * `fga/model.fga` を動いている OpenFGA へ送り、固定すべき id を印字する。
 *
 * shell にそのまま貼れる代入を 2 行出す:
 *
 *   WAGGLE_FGA_STORE_ID=01K...
 *   WAGGLE_FGA_MODEL_ID=01K...
 *
 * モデルの id を固定することには意味がある。認可モデルは不変で、書き込むたびに
 * 新しい id が生まれる。id を省いた client は **そのとき最も新しいもの** に対して
 * 評価するので、モデルを編集した瞬間にすべての判断が黙って変わる。環境変数を
 * 上げることが、その切り替えをコードの配備とは別の意図的な一歩にしている。
 *
 * store は 1 度作って以後は使い回す: 名前の一致する既存の store は、複製せず
 * そのまま採用するので、これを再実行しても安全。
 */
import { spawnSync } from "node:child_process";
import { guardEnv, optional } from "./env.mjs";

guardEnv();

const API_URL = optional("WAGGLE_FGA_API_URL", "http://localhost:8090");
const API_TOKEN = optional("WAGGLE_FGA_API_TOKEN", "dev-key");
const STORE_NAME = optional("WAGGLE_FGA_STORE_NAME", "waxlens");

const fga = (args) => {
  const result = spawnSync("fga", args, {
    encoding: "utf8",
    env: { ...process.env, FGA_API_URL: API_URL, FGA_API_TOKEN: API_TOKEN },
  });
  if (result.status !== 0) {
    const detail = `${result.stdout ?? ""}${result.stderr ?? ""}`.trim();
    throw new Error(`fga ${args.join(" ")} failed:\n${detail}`);
  }
  return result.stdout;
};

const findStore = () => {
  const listed = JSON.parse(fga(["store", "list"]));
  return (listed.stores ?? []).find((s) => s.name === STORE_NAME);
};

const store = findStore() ?? JSON.parse(fga(["store", "create", "--name", STORE_NAME]));
// `store create` は store を入れ子で返し、`store list` は平らに返す。
const storeId = store.id ?? store.store?.id;
if (!storeId) throw new Error(`could not determine store id from: ${JSON.stringify(store)}`);

const written = JSON.parse(
  fga(["model", "write", "--store-id", storeId, "--file", "fga/model.fga"]),
);
const modelId = written.authorization_model_id;
if (!modelId) throw new Error(`could not determine model id from: ${JSON.stringify(written)}`);

process.stdout.write(`WAGGLE_FGA_STORE_ID=${storeId}\n`);
process.stdout.write(`WAGGLE_FGA_MODEL_ID=${modelId}\n`);
