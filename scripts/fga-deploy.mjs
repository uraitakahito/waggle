#!/usr/bin/env node
/**
 * Push `fga/model.fga` to the running OpenFGA and print the ids to pin.
 *
 * Prints two shell-ready assignments:
 *
 *   WAGGLE_FGA_STORE_ID=01K...
 *   WAGGLE_FGA_MODEL_ID=01K...
 *
 * Pinning the model id matters. Authorization models are immutable and every
 * write mints a new one; a client that omits the id evaluates against
 * *whatever is newest*, so editing the model would silently change every
 * decision the moment it lands. Bumping the env var is what makes the switch
 * a deliberate, separate step from deploying code.
 *
 * The store is created once and then reused: an existing store whose name
 * matches is adopted rather than duplicated, so re-running this is safe.
 */
import { spawnSync } from "node:child_process";

const API_URL = process.env["WAGGLE_FGA_API_URL"] ?? "http://localhost:8090";
const API_TOKEN = process.env["WAGGLE_FGA_API_TOKEN"] ?? "dev-key";
const STORE_NAME = process.env["WAGGLE_FGA_STORE_NAME"] ?? "waxlens";

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
// `store create` nests the store; `store list` returns it flat.
const storeId = store.id ?? store.store?.id;
if (!storeId) throw new Error(`could not determine store id from: ${JSON.stringify(store)}`);

const written = JSON.parse(
  fga(["model", "write", "--store-id", storeId, "--file", "fga/model.fga"]),
);
const modelId = written.authorization_model_id;
if (!modelId) throw new Error(`could not determine model id from: ${JSON.stringify(written)}`);

process.stdout.write(`WAGGLE_FGA_STORE_ID=${storeId}\n`);
process.stdout.write(`WAGGLE_FGA_MODEL_ID=${modelId}\n`);
