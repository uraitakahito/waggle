import { defineConfig } from "@hey-api/openapi-ts";

/**
 * Configuration for @hey-api/openapi-ts.
 *
 * Input: openapi/browserhive.yaml (vendored copy of upstream
 * BrowserHive's src/http/openapi.yaml — refresh via `npm run openapi:sync`).
 *
 * Output: src/http/generated/ — checked-in to the repo. CI runs
 * `npm run openapi:check` to verify the generated tree is in sync with
 * the spec; drift fails the build.
 *
 * The `module.extension: ".js"` option appends explicit extensions to
 * relative imports in the generated code, which Node's NodeNext ESM
 * resolver requires.
 */
export default defineConfig({
  input: {
    // Leading "./" is required: paths without it are interpreted by
    // hey-api as `organization/project` shorthand for the Hey API
    // registry. See node_modules/@hey-api/shared/src/utils/input/index.ts.
    path: "./openapi/browserhive.yaml",
  },
  output: "src/http/generated",
  plugins: ["@hey-api/client-fetch"],
});
