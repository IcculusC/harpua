# Adding a new packages/* library

Workspaces are globbed by `pnpm-workspace.yaml` (`packages/*`, `apps/*`) and by `turbo.json` — a new dir under `packages/` is picked up automatically. No root edits needed. Copy conventions from `packages/langgraph`.

## Steps

1. `mkdir packages/<name>` with `src/index.ts`.

2. **`package.json`** — mirror `packages/langgraph/package.json`:
   - `"name": "@harpua/<name>"`, `"version": "0.0.0"`, `"private": true`, `"license": "UNLICENSED"`.
   - `"type": "module"`, `"exports": { ".": { "types": "./dist/index.d.ts", "default": "./dist/index.js" } }` (copy the shape from `packages/langgraph/package.json`), `"files": ["dist"]`.
   - `scripts`: `"build": "tsc -p tsconfig.build.json"`, `"lint": "eslint \"src/**/*.ts\""`, `"test": "vitest run"`.
   - A `vitest.config.ts` (copy `packages/models/vitest.config.ts`: `unplugin-swc` plugin, `include: ["src/**/*.spec.ts"]`, `testTimeout: 30000`); dev-deps `vitest`, `unplugin-swc`, `@swc/core`. Specs import `describe/it/expect/vi` from `"vitest"` explicitly.
   - Dev-dep the workspace configs: `"@harpua/eslint-config": "workspace:*"`, `"@harpua/typescript-config": "workspace:*"`. Internal deps also use `workspace:*` (e.g. `"@harpua/langgraph": "workspace:*"`).

3. **`tsconfig.json`** — `extends: "@harpua/typescript-config/library.json"` (adds `declaration`, `declarationMap`, `outDir: ./dist`; inherits `base.json`'s `NodeNext`, so the package is ESM). If the library uses decorators (Nest providers), also set `experimentalDecorators`/`emitDecoratorMetadata` (see `packages/langgraph/tsconfig.json`). ESM rules: `"type": "module"` in `package.json`, `.js` extension on every relative import, an `exports` map instead of a bare `main`.
   - Add `"tsconfig.build.json"` extending `./tsconfig.json` that excludes tests (`src/__tests__/**`, `*.spec.ts`, `*.type-spec.ts`).

4. **`eslint.config.mjs`** — flat config spreading the shared base:
   ```js
   import { base } from "@harpua/eslint-config/base";
   export default [...base, { rules: { /* package overrides */ } }];
   ```
   (Nest apps use `@harpua/eslint-config/nestjs` instead — libraries use `base`.)

5. `pnpm install` to link the workspace, then verify (root protocol) — turbo's `build`/`lint`/`test` tasks apply to the new package automatically.

## Optional peer dependencies (wrapping optional drivers)

If the library optionally wraps drivers the consumer may not install (as `@harpua/langgraph` does for the four checkpoint savers): declare them under `peerDependencies` + `peerDependenciesMeta: { "<pkg>": { "optional": true } }`, keep them in `devDependencies` for local build/test, and **never import them at module load** — load lazily inside a `try/catch`, translating `MODULE_NOT_FOUND` into an actionable "run `pnpm add <pkg>`" error. Pattern to copy: `packages/langgraph/src/checkpointer.ts` + `optional-require.ts`.

## Common Mistakes

- Editing root `package.json`/`turbo.json`/`pnpm-workspace.yaml` to "register" the package — the globs already cover it; just `pnpm install`.
- Extending `nestjs.json` or the nestjs eslint config for a library — those are for `apps/*`. Libraries extend `library.json` + `base` eslint.
- Forgetting the `.js` extension on relative imports, or the decorator flags on a Nest-consumed package — `NodeNext` fails the build without the former, DI metadata silently goes missing without the latter.
- Importing an optional peer at top level, so a consumer who didn't install it crashes at load instead of getting the fail-fast message.
- Verifying just the new package (`pnpm --filter … test`) instead of the root protocol `pnpm turbo build lint test --force`.
