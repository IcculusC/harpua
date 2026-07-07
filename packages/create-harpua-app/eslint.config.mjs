import { base } from "@harpua/eslint-config/base";

export default [
  ...base,
  {
    // The embedded template ships its own standalone toolchain; never lint it
    // as part of this package.
    ignores: ["template/**", "dist/**"],
  },
];
