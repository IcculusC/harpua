---
name: adding-things
description: Use when adding a tool, node, edge, graph, subgraph, Nest module, checkpointer, or a new packages/* library to the harpua monorepo (@harpua/langgraph + apps/api). Routes to the right recipe.
---

# Adding things to harpua

Classify what you're adding, read the one matching reference, then follow it. Don't skim the codebase to rediscover conventions the references already state.

| Adding… | Read |
|---|---|
| A `@LangGraphTool` method, or a new tool provider class | `references/tool.md` |
| A `NodeHandler` and wiring its edge (incl. `interrupt()`) | `references/node.md` |
| A whole graph, a subgraph, a Nest module, or a checkpointer | `references/graph.md` |
| A new `packages/*` library | `references/package.md` |

## Three rules for every addition

1. **Verify with the root protocol, not per-package.** Finish with, from the repo root, `pnpm turbo build lint test --force`. If `apps/api` runtime behavior changed, also boot it and curl the affected flow, and run the piped CLI check. Full protocol and exact commands: the `verify` skill.
2. **Tests stay deterministic.** Inject a clock or reference date; never call bare `new Date()` in logic under test, even to "match the suite."
3. **Prefer Nest CLI schematics** over hand-writing standard Nest artifacts: `pnpm --filter @harpua/api exec nest g <schematic> <name>` (e.g. `service`, `module`, `controller`). Hand-write only what has no schematic — nodes, graphs, tool providers, edge lists.
