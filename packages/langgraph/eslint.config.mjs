import { base } from "@harpua/eslint-config/base";

export default [
  ...base,
  {
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/explicit-module-boundary-types": "off",
    },
  },
];
