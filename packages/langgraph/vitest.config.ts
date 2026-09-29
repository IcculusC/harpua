import { createRequire } from "node:module";

import swc from "unplugin-swc";
import { defineConfig } from "vitest/config";

const require = createRequire(import.meta.url);

// unplugin-swc emits decorator metadata (esbuild, Vitest's default, does not),
// which Nest DI needs. It reads experimentalDecorators/emitDecoratorMetadata
// from tsconfig.json.
export default defineConfig({
  plugins: [
    swc.vite(),
    {
      // Our libraries build to CommonJS and `require` @langchain/* (also via
      // optional-require), while spec files `import` them (ESM entries). Two
      // module instances break `instanceof` and prototype spies (StateSchema,
      // ToolMessage, PostgresSaver, ...). Resolve the specs' imports through
      // Node's `require` conditions so both sides share one CJS copy. Goes away
      // when the packages move to ESM.
      name: "langchain-single-instance",
      enforce: "pre",
      resolveId(id) {
        if (/^@langchain\//.test(id)) return require.resolve(id);
      },
    },
  ],
  test: {
    include: ["src/**/*.spec.ts"],
    environment: "node",
    testTimeout: 30000,
  },
});
