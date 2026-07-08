# @harpua/langgraph

## 0.1.2

### Patch Changes

- 07e9733: Add tool binding so a real chat model can emit the tool calls a graph's `TOOLS`
  node executes. New `provideGraphBoundModel({ provide, graph, model })` Nest
  custom-provider factory binds a graph's tools (`model.bindTools(...)`) to any
  DI token resolving to a `BaseChatModel` — the package stays model-library
  agnostic. Lower-level primitives `provideGraphTools({ graph })` +
  `getGraphToolsToken(graph)` expose the raw `StructuredToolInterface[]` for
  manual binding, and `buildGraphTools(graphDef, moduleRef)` is the single source
  of truth the `ToolNode` builder and the binding providers both use (so the
  model's advertised tools and the executor never drift). New `GraphBoundModel`
  type for annotating the injected token. A graph with no tools returns the model
  unchanged.
- 2a42d42: graph-operations recipes now lead with Nest schematic generate steps (node/tool provider → `nest g provider`, graph definition → `nest g class`) and forbid inlining new nodes/providers/graph-defs into existing files.
- cd21094: Ship a `graph-operations` skill reference for wiring chat models with `@harpua/models` (`references/models.md`), routed from the skill's SKILL.md.

## 0.1.1

### Patch Changes

- 4e6d572: Add the `harpua-skills` CLI. Run it (or set `"prepare": "harpua-skills"`) in a consuming project to link the agent skills shipped by installed `@harpua/*` packages into `.claude/skills` and `.agents/skills`, so Claude Code and Codex discover them automatically. Relative symlinks on POSIX, directory junctions on Windows; idempotent; never clobbers user-owned directories.
