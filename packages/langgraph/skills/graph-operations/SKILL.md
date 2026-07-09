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
| An **agent loop** (model↔tools) with `@LangGraphAgent`: capping turns/tokens or avoiding `GraphRecursionError`, retrying model/tool calls, trimming/compacting history, stopping the loop early, or writing a custom `@LangGraphMiddleware` | `references/agents-and-middleware.md` |
| Wiring a chat model (env-driven, named models, OpenRouter/Ollama/openai-compatible, mock default) with `@harpua/models` | `references/models.md` |
| Testing a graph, a node, or an agentic loop (unit, e2e, scripted model, interrupt, streaming, persistence, type-level) | `references/testing.md` |
| Debugging / inspecting state (bootstrap or runtime errors, time travel, checkpoint store) | `references/debugging.md` |
| An approval gate or any human-in-the-loop pause (interrupt payloads, resume, HTTP/SSE/CLI surfacing, multi-step) | `references/human-in-the-loop.md` |
| Streaming a graph (choosing a mode, facade helpers, SSE controller, multi-mode tuples, interrupt terminator) | `references/streaming.md` |
| Choosing or configuring a checkpointer backend (memory/sqlite/postgres/redis/mongodb, ownership, optional peers, TTL) | `references/checkpointers.md` |
| Tracing graphs/nodes/tools with OpenTelemetry (span hierarchy + attributes, enabling an SDK, Langfuse wiring, span tests) | `references/observability.md` |

## Three rules for every addition

1. **Verify with your project's build and test suite before reporting done.** Run whatever your project uses to build, lint, and test — don't call a change done on a passing unit test alone if the project also has an integration or e2e layer that exercises the same path.
2. **Tests stay deterministic.** Inject a clock or reference date; never call bare `new Date()` in logic under test, even to "match the suite."
3. **Every recipe BEGINS with a schematic that generates the file — run it before you write any code.** Nodes and tool providers ARE providers; a graph-def class IS a class, so a schematic covers almost everything you add:

   | Artifact you're adding | Generate with |
   |---|---|
   | Node (`NodeHandler`) | `nest g provider` |
   | Tool provider (`@LangGraphTool` methods) | `nest g provider` |
   | Graph definition (`@LangGraph` class) | `nest g class` |
   | Nest module | `nest g module` |
   | Service / controller | `nest g service` / `nest g controller` |

   One node, tool provider, or graph-def **per file, each from its schematic** — NEVER hand-written, and NEVER inlined into an existing file "because the pattern is already there". A class merely typed inside the graph file is not a DI provider; the schematic writes the file, its spec, and (for a provider) the module `providers: [...]` registration for you. The only things you author by hand are the edge list and decorator config INSIDE the generated file.
