import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";

// Self-contained flat config so the scaffolded project stands alone (no shared
// @harpua config packages).
export default tseslint.config(
  {
    ignores: ["dist/**", "node_modules/**", "coverage/**"],
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
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/explicit-module-boundary-types": "off",
    },
  },
);
