import { createRequire } from "node:module";

/**
 * Lazily loads an optional peer dependency by name at runtime. The checkpoint
 * saver packages are declared as OPTIONAL peer dependencies of
 * `@harpua/langgraph`, so they are only present when the consumer actually
 * installs them. Kept in its own tiny module so tests can spy on it to
 * simulate a package not being installed.
 */
export function requireOptionalModule(pkg: string): unknown {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require(pkg);
}

/**
 * Requires a package resolved relative to another already-installed package.
 * Used to reach a driver (e.g. `mongodb`) that ships as a dependency of a
 * checkpoint saver package rather than a direct dependency of this library.
 */
export function requirePeerOf(pkg: string, host: string): unknown {
  const req = createRequire(require.resolve(host));
  return req(pkg);
}
