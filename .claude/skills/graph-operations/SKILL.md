---
name: graph-operations
description: Use when adding a tool, node, edge, graph, subgraph, Nest module, checkpointer, or a new packages/* library to the harpua monorepo (@harpua/langgraph + apps/api). Routes to the right recipe.
---

# Adding things to harpua

Classify what you're adding, read the one matching reference, then follow it. Don't skim the codebase to rediscover conventions the references already state.

| Adding… | Read |
|---|---|
| A `@LangGraphTool` method, or a new tool provider class | `packages/langgraph/skills/graph-operations/references/tool.md`, then apply the harpua overlay below |
| A `NodeHandler` and wiring its edge (incl. `interrupt()`) | `packages/langgraph/skills/graph-operations/references/node.md`, then apply the harpua overlay below |
| A whole graph, a subgraph, a Nest module, or a checkpointer | `packages/langgraph/skills/graph-operations/references/graph.md`, then apply the harpua overlay below |
| A new `packages/*` library | `references/package.md` |
| Debugging / inspecting state (bootstrap or runtime errors, time travel, checkpoint store) | `packages/langgraph/skills/graph-operations/references/debugging.md` |

The tool/node/graph recipes ship framework-generic with `@harpua/langgraph` itself, at the workspace-relative path above — in this monorepo, read that source directly rather than a copy under `.claude/skills/`.

## Harpua overlay

The package-level recipes above are framework-generic and know nothing about this repo. Three repo-specific deltas layer on top — full detail in `references/harpua.md`:

1. **Verify with the root protocol, not per-package.** `pnpm turbo build lint test --force` from the repo root, plus boot/curl/CLI checks when `apps/api` runtime behavior changed. Full protocol and exact commands: the `verify` skill.
2. **The chat demo's model is a deterministic mock**, not a real LLM (`apps/api/src/chat/mock-chat-model.ts`). Adding a user-facing tool or node? You must teach it routing *and* update its canned help text, or it's dead code the demo never reaches.
3. **This repo's exemplar file paths** (tool/node/graph/module/test exemplars under `apps/api/src/chat/*` and `packages/langgraph/src/__tests__/*`) live in `references/harpua.md`, not in the generic recipes.
