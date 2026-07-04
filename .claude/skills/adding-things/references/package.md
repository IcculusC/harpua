# Adding a new packages/* library

Workspaces are globbed by `pnpm-workspace.yaml` (`packages/*`, `apps/*`) and by `turbo.json` — a new dir under `packages/` is picked up automatically. No root edits needed. Copy conventions from `packages/langgraph`.

## Steps

1. `mkdir packages/<name>` with `src/index.ts`.

2. **`package.json`** — mirror `packages/langgraph/package.json`:
   - `"name": "@harpua/<name>"`, `"version": "0.0.0"`, `"private": true`, `"license": "UNLICENSED"`.
   - `"main": "dist/index.js"`, `"types": "dist/index.d.ts"`, `"files": ["dist"]`.
   - `scripts`: `"build": "tsc -p tsconfig.build.json"`, `"lint": "eslint \"src/**/*.ts\""`, `"test": "jest"`.
   - Inline `jest` block (ts-jest, `rootDir: src`, `testRegex: ".*\\.spec\\.ts$"`).
   - Dev-dep the workspace configs: `"@harpua/eslint-config": "workspace:*"`, `"@harpua/typescript-config": "workspace:*"`. Internal deps also use `workspace:*` (e.g. `"@harpua/langgraph": "workspace:*"`).

3. **`tsconfig.json`** — `extends: "@harpua/typescript-config/library.json"` (adds `declaration`, `declarationMap`, `outDir: ./dist`). Then decide the module format:
   - **CJS override pattern** (what `@harpua/langgraph` uses): also set `"module": "CommonJS"`, `"moduleResolution": "Node10"`, `experimentalDecorators`/`emitDecoratorMetadata`. Use this whenever the library is consumed by the Nest app or uses decorators — it matches Nest 11's CommonJS output.
   - **Plain library**: extend `library.json` unchanged (inherits `base.json`'s `NodeNext`) if the package is decorator-free and ESM-friendly.
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
- Extending `library.json` but leaving `NodeNext`/decorators wrong for a Nest-consumed package — apply the CJS override.
- Importing an optional peer at top level, so a consumer who didn't install it crashes at load instead of getting the fail-fast message.
- Verifying just the new package (`pnpm --filter … test`) instead of the root protocol `pnpm turbo build lint test --force`.
