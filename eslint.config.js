import js from "@eslint/js";
import tseslint from "typescript-eslint";
import prettier from "eslint-config-prettier";

export default tseslint.config(
  {
    ignores: [
      "dist/**",
      "node_modules/**",
      "src/http/generated/**",
      // docs-site is a separate npm project with its own tsconfig and Astro
      // types; linting it from here fails on generated .astro/ modules that
      // the root tsconfig cannot see.
      "docs-site/**",
      // Repo tooling run directly by node, outside the TS project.
      "scripts/**",
      // Upstream source, vendored as a submodule. It has its own lint setup;
      // linting it from here just reports on somebody else's code.
      ".upstream/**",
      "coverage/**",
      "*.config.js",
      "*.config.cjs",
      "*.config.mjs",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    files: ["test/**/*.ts"],
    rules: {
      "@typescript-eslint/no-non-null-assertion": "off",
    },
  },
  prettier,
);
