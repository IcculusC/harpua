# Migrating to harpua 1.0

1.0 moves every `@harpua/*` package (and the `create-harpua-app` scaffold) to ESM on NestJS 12. The
public APIs are unchanged; what changed is how the packages are built and loaded, and what they require.

Affected packages: `@harpua/langgraph`, `@harpua/langgraph-testing`, `@harpua/models`,
`@harpua/agent-tools`, `create-harpua-app`.

## Checklist

1. **Node >=22.12.** Node 20 and Node 22 before 22.12 are no longer supported (`engines` is declared on
   every package). Node 24 is what the repo develops against.
2. **NestJS 12.** `@nestjs/common`, `@nestjs/core` (and `@nestjs/testing` for `@harpua/langgraph-testing`)
   must be `^12.0.0`; the peer ranges no longer accept Nest 11.
3. **ESM-only packages.** Every package is `"type": "module"` with an `exports` map. There is no CommonJS
   build.
   - **ESM apps** (`"type": "module"`, `NodeNext`): nothing to do.
   - **CommonJS apps** keep working on Node >=22.12 because `require()` can load ES modules
     (`require(esm)`). A module that uses top-level `await` cannot be `require()`d.
   - Type-check with `"moduleResolution": "NodeNext"` (or `Bundler`). The legacy `Node10` resolution
     ignores `exports` maps and will not find the types.
4. **Exports map and deep imports.** Each package exposes only `"."` and `"./package.json"`. Imports such as
   `@harpua/langgraph/dist/...` now fail with `ERR_PACKAGE_PATH_NOT_EXPORTED`; import from the package
   root.
5. **Optional peers load their ESM entry.** `@harpua/langgraph` (checkpoint savers, OpenTelemetry) and
   `@harpua/models` (the `@langchain/*` model arms) resolve optional peers through each package's `import`
   condition, so they share your app's single copy of `@langchain/core`. If you worked around dual
   CJS/ESM `@langchain/*` copies (aliases, resolver plugins, `instanceof` shims), remove those
   workarounds. A missing optional peer still fails fast with an install hint.
6. **Your own ESM code.** Under `NodeNext`, relative imports need extensions (`"./x.js"`, which TypeScript
   maps back to `x.ts`). `__dirname`/`__filename` do not exist in ESM; use `import.meta.dirname` /
   `import.meta.filename`.
7. **Tests: Vitest, not Jest.** Jest cannot load Nest 12 or ESM packages without heavy configuration.
   Scaffolded projects use Vitest with `unplugin-swc` (esbuild, Vitest's default transformer, does not
   emit the decorator metadata Nest DI needs). Copy `vitest.config.ts` from the template and import
   `describe`, `it`, `expect`, `vi` from `"vitest"` explicitly.

## Scaffolds

New projects come from `npm create harpua-app@latest`: ESM, `NodeNext`, SWC build via Nest CLI 12, Vitest,
Node >=22.12 in `engines`.

To convert an existing scaffold by hand:

- `package.json`: add `"type": "module"` and `"engines": { "node": ">=22.12" }`; move `@harpua/*` to
  `^1.0.0` (`^1.0.0-next.1` while 1.0 is still a prerelease) and Nest packages to `^12.0.0`; replace Jest
  with `vitest` + `unplugin-swc`.
- `tsconfig.json`: `"module": "NodeNext"`, `"moduleResolution": "NodeNext"`.
- Add `.js` to every relative import; replace `__dirname`.
- Delete the `jest` config and any resolver plugin that forced a single CJS copy of `@langchain/*`.

## Versioning

Versions before 1.0 followed 0.x semver (breaking = minor). From 1.0, breaking changes are major bumps.
