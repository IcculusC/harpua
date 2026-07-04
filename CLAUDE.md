# harpua

Reusable toolkit for LangGraph + NestJS. Libraries live in `packages/*` (the product); `apps/api` and its ChatModule/CLI are proof harnesses, not the product.

## Skills — read these before working

- **Adding anything** (tool, node, graph, subgraph, module, package): read `.claude/skills/graph-operations/SKILL.md` FIRST and follow the reference it routes you to. Do not rediscover conventions by skimming the codebase — the recipes state them. Framework-generic recipes live in `packages/langgraph/skills/` (they ship with the npm package); the repo overlay with harpua-specific deltas is `.claude/skills/graph-operations/references/harpua.md`.
- **Before claiming anything is done/verified**: follow `.claude/skills/verify/SKILL.md`. The bar is the ROOT protocol — `pnpm turbo build lint test --force` from the repo root — plus boot/curl and the piped CLI check when `apps/api` runtime behavior changed. Per-package `--filter` runs are not sufficient verification.

## Conventions

- pnpm workspaces + Turborepo. Run tasks from the repo root via `pnpm turbo <task>`.
- State definitions are **zod-first** (`StateSchema` + `MessagesValue`; `StateOf<>` for types). `Annotation.Root` is accepted but not the canonical style.
- Libraries consumed by Nest 11 apps build to **CommonJS** (see `packages/langgraph/tsconfig.json`); ESM-native libs extend `library.json` unchanged.
- Tests must be deterministic: inject clocks/reference dates, never bare `new Date()` in logic under test.
- Prefer Nest CLI schematics (`pnpm --filter <pkg> exec nest g <schematic> <name>`) over hand-writing standard Nest artifacts.
- Package names carry no framework prefixes: `@harpua/langgraph`, not `@harpua/nestjs-langgraph`.
- Commits: no AI attribution trailers of any kind.
