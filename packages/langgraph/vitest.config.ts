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
      // The optional checkpoint-saver peers are loaded by optional-require.ts
      // through createRequire, so the library gets their require() (CJS) entries. Specs
      // that `import` the same packages would get the ESM entries: a second
      // instance, which breaks `instanceof` and prototype spies (PostgresSaver,
      // SqliteSaver, ...). Resolve the specs' imports the way the library does
      // so both sides share one copy. (Everything else, including
      // @langchain/core and @langchain/langgraph, is imported as ESM on both
      // sides now.)
      name: "checkpoint-savers-single-instance",
      enforce: "pre",
      resolveId(id) {
        if (/^@langchain\/langgraph-checkpoint-/.test(id)) {
          return require.resolve(id);
        }
      },
    },
  ],
  test: {
    include: ["src/**/*.spec.ts"],
    environment: "node",
    testTimeout: 30000,
  },
});
