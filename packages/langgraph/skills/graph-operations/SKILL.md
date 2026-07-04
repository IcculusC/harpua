---
name: graph-operations
description: Use when adding a tool, node, edge, graph, or subgraph to a NestJS app using @harpua/langgraph. Routes to the right recipe.
---

# Adding things with @harpua/langgraph

Classify what you're adding, read the one matching reference, then follow it. Don't skim the codebase to rediscover conventions the references already state.

| Adding… | Read |
|---|---|
| A `@LangGraphTool` method, or a new tool provider class | `references/tool.md` |
| A `NodeHandler` and wiring its edge (incl. `interrupt()`) | `references/node.md` |
| A whole graph, a subgraph, a Nest module, or a checkpointer | `references/graph.md` |
| Testing a graph, a node, or an agentic loop (unit, e2e, scripted model, interrupt, streaming, persistence, type-level) | `references/testing.md` |
| Debugging / inspecting state (bootstrap or runtime errors, time travel, checkpoint store) | `references/debugging.md` |

## Three rules for every addition

1. **Verify with your project's build and test suite before reporting done.** Run whatever your project uses to build, lint, and test — don't call a change done on a passing unit test alone if the project also has an integration or e2e layer that exercises the same path.
2. **Tests stay deterministic.** Inject a clock or reference date; never call bare `new Date()` in logic under test, even to "match the suite."
3. **Prefer your framework's schematics** over hand-writing standard Nest artifacts: `nest g <schematic> <name>` (e.g. `service`, `module`, `controller`). Hand-write only what has no schematic — nodes, graphs, tool providers, edge lists.
