import type { UnpdfModuleLike } from "./options";

/*
 * The default `fetch_pdf` loader. `unpdf` is ESM-only, but this package builds
 * to CommonJS (Nest 11). A literal `import("unpdf")` in TypeScript source is
 * downleveled by `tsc` under `module: CommonJS` into
 * `Promise.resolve().then(() => require("unpdf"))` — a `require()`, which cannot
 * load an ESM-only package at runtime. Hiding the import inside a `Function`
 * body keeps it out of tsc's sight, so a genuine dynamic `import()` survives
 * into the emitted `dist` and loads the ESM module regardless of Node's
 * `require(esm)` support. Verified against the built output.
 */
const dynamicImport = new Function(
  "specifier",
  "return import(specifier);",
) as (specifier: string) => Promise<unknown>;

/**
 * Lazily import `unpdf`. `fetch_pdf` injects this by default; tests override it
 * to exercise the missing-package path deterministically. Returns the module
 * narrowed to the {@link UnpdfModuleLike} surface `fetch_pdf` actually uses.
 */
export function loadUnpdf(): Promise<UnpdfModuleLike> {
  return dynamicImport("unpdf") as Promise<UnpdfModuleLike>;
}
