import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);

/**
 * Lazily loads an optional peer dependency by name at runtime. The LangChain
 * integration packages (`@langchain/openrouter`, `@langchain/ollama`,
 * `@langchain/openai`) are declared as OPTIONAL peer dependencies of
 * `@harpua/models`, so they are only present when the consumer actually
 * installs the arm they picked. Kept in its own tiny module so tests can spy on
 * it to simulate a package not being installed.
 *
 * Stays synchronous so the public API does not become async. It resolves the
 * package's ESM ("import") entry with `import.meta.resolve` and loads it via
 * `require(esm)`, so the peer shares THIS app's single ESM copy of
 * `@langchain/core` (a plain `require(pkg)` would pick the peer's CJS entry and
 * a second, CJS copy of core: distinct classes and split AsyncLocalStorage /
 * callback singletons). CJS-only peers still work (resolve returns their CJS
 * file). A missing peer throws `ERR_MODULE_NOT_FOUND`, which callers translate
 * into an install hint.
 *
 * This seam is intentionally copied (not imported from `@harpua/langgraph`):
 * `@harpua/models` is graph-agnostic and carries no dependency on that package.
 */
export function requireOptionalModule(pkg: string): unknown {
  return require(fileURLToPath(import.meta.resolve(pkg)));
}
