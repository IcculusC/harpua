import swc from "unplugin-swc";
import { defineConfig } from "vitest/config";

// unplugin-swc emits decorator metadata (esbuild, Vitest's default, does not),
// which Nest DI needs. It reads experimentalDecorators/emitDecoratorMetadata
// from tsconfig.json.
export default defineConfig({
  plugins: [swc.vite()],
  test: {
    include: ["src/**/*.spec.ts"],
    environment: "node",
    testTimeout: 30000,
  },
});
