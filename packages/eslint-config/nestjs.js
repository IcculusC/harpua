import tseslint from "typescript-eslint";
import { base } from "./base.js";

/**
 * Shared flat ESLint config for Harpua NestJS apps.
 * @type {import("eslint").Linter.Config[]}
 */
export const nestjs = tseslint.config(...base, {
  rules: {
    "@typescript-eslint/interface-name-prefix": "off",
    "@typescript-eslint/explicit-function-return-type": "off",
    "@typescript-eslint/explicit-module-boundary-types": "off",
    "@typescript-eslint/no-explicit-any": "off",
  },
});

export default nestjs;
