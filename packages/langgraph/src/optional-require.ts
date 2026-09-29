import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);

/**
 * Lazily loads an optional peer dependency by name at runtime. The checkpoint
 * saver packages are declared as OPTIONAL peer dependencies of
 * `@harpua/langgraph`, so they are only present when the consumer actually
 * installs them. Kept in its own tiny module so tests can spy on it to
 * simulate a package not being installed.
 *
 * Stays synchronous so the public API does not become async. It resolves the
 * package's ESM ("import") entry with `import.meta.resolve` and loads it via
 * `require(esm)`, so the peer shares THIS app's single ESM copy of
 * `@langchain/core` (a plain `require(pkg)` would pick the peer's CJS entry and
 * a second, CJS copy of core: distinct classes and split AsyncLocalStorage /
 * callback singletons). CJS-only peers still work (resolve returns their CJS
 * file). A missing peer throws `ERR_MODULE_NOT_FOUND`, which callers translate
 * into an install hint. `require` resolves from THIS package, i.e. the host app's
 * node_modules.
 */
export function requireOptionalModule(pkg: string): unknown {
  return require(fileURLToPath(import.meta.resolve(pkg)));
}

/**
 * Requires a package resolved relative to another already-installed package.
 * Used to reach a driver (e.g. `mongodb`) that ships as a dependency of a
 * checkpoint saver package rather than a direct dependency of this library.
 * Left on plain `createRequire`: the driver's classes are not shared with the
 * app's LangChain graph, so there is no dual-instance concern.
 */
export function requirePeerOf(pkg: string, host: string): unknown {
  const req = createRequire(require.resolve(host));
  return req(pkg);
}
