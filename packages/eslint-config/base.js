import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";

import { noTopLevelAwait } from "./no-top-level-await.js";

/**
 * Shared flat ESLint config for Harpua TypeScript packages.
 * @type {import("eslint").Linter.Config[]}
 */
export const base = tseslint.config(
  {
    ignores: ["dist/**", "node_modules/**", "coverage/**", ".turbo/**"],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
  {
    // Published modules must stay require(esm)-safe: see no-top-level-await.js.
    files: ["src/**/*.ts"],
    ignores: ["**/*.spec.ts", "**/__tests__/**"],
    plugins: { harpua: noTopLevelAwait },
    rules: { "harpua/no-top-level-await": "error" },
  },
);

export default base;
