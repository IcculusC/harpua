---
"@harpua/langgraph": patch
---

Add tool binding so a real chat model can emit the tool calls a graph's `TOOLS`
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
