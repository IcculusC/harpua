# harpua

Reusable toolkit for LangGraph + NestJS. Libraries live in `packages/*` (the product); `apps/api` and its ChatModule/CLI are proof harnesses, not the product.

## Skills — read these before working

- **Adding anything** (tool, node, graph, subgraph, module, package): read `.claude/skills/graph-operations/SKILL.md` FIRST and follow the reference it routes you to. Do not rediscover conventions by skimming the codebase — the recipes state them. Framework-generic recipes live in `packages/langgraph/skills/` (they ship with the npm package); the repo overlay with harpua-specific deltas is `.claude/skills/graph-operations/references/harpua.md`.
- **Changing a publishable package** (source, deps, or public API): read `.claude/skills/release/SKILL.md` — when a change needs a changeset, which bump to pick, and how the Version Packages release train ships it.
- **Before claiming anything is done/verified**: follow `.claude/skills/verify/SKILL.md`. The bar is the ROOT protocol — `pnpm turbo build lint test --force` from the repo root — plus boot/curl and the piped CLI check when `apps/api` runtime behavior changed. Per-package `--filter` runs are not sufficient verification.

## Conventions

- pnpm workspaces + Turborepo. Run tasks from the repo root via `pnpm turbo <task>`.
- Scope with `--filter`: `--filter @harpua/api` (just that package), `--filter ...@harpua/langgraph` (it plus everything that depends on it), `--filter @harpua/langgraph...` (it plus its dependencies). Adding a package needs no `turbo.json` change (workspace globs).
- Use `--force` after env/config changes or when validating for a report — a cached `FULL TURBO` result replays a prior pass and can mask staleness.
- Run one spec: `pnpm --filter <pkg> exec jest <name> -t 'pattern'`. `dev` is persistent and uncached; don't expect it to terminate. Deeper task/cache mechanics: `.claude/skills/turbo/SKILL.md`.
- State definitions are **zod-first** (`StateSchema` + `MessagesValue`; `StateOf<>` for types). `Annotation.Root` is accepted but not the canonical style.
- Libraries consumed by Nest 11 apps build to **CommonJS** (see `packages/langgraph/tsconfig.json`); ESM-native libs extend `library.json` unchanged.
- Tests must be deterministic: inject clocks/reference dates, never bare `new Date()` in logic under test.
- **Zod for all runtime validation and parsing — never hand-roll type guards.** No `isRecord`, `isNonEmptyString`, `isNegativeNumber`, or similar helper functions: that's `z.record(...)`, `z.string().min(1)`, `z.number().negative()` with `.parse()`/`.safeParse()` at the boundary. Derive the TS type with `z.infer` instead of writing it twice. If you're writing a function whose only job is to check a value's shape, stop — it's a zod schema.
- Prefer Nest CLI schematics (`pnpm --filter <pkg> exec nest g <schematic> <name>`) over hand-writing standard Nest artifacts.
- **One artifact per file.** A new node, tool provider, graph def, or service gets its own file (generated with a schematic where one exists) — never appended to an existing file because the pattern is already there. No god files.
- Package names carry no framework prefixes: `@harpua/langgraph`, not `@harpua/nestjs-langgraph`.
- Changes to a publishable package (`@harpua/langgraph`, `@harpua/langgraph-testing`, `@harpua/agent-tools`) must include a changeset (`pnpm exec changeset`); docs-only and repo-tooling changes don't.
- Commits: no AI attribution trailers of any kind.
- Work lands via feature-branch pull requests, not direct commits to main. Branch per iteration (`feat/<slug>`, `fix/<slug>`, `docs/<slug>`), full verify before pushing the branch, PR merged by the maintainer.
