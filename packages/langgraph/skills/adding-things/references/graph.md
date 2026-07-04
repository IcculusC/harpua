# Adding a graph, subgraph, module, or checkpointer

A graph is a class decorated with `@LangGraph({ name, state, tools?, recursionLimit? })` exposing an `edges` array. Graphs are built and compiled once at `onApplicationBootstrap` from the DI container.

## Steps: a new graph

1. **Declare state.** Canonical for message/agent graphs: `new StateSchema({ messages: MessagesValue })`, then `type S = StateOf<typeof Schema>`. Any bare zod object (or `Annotation.Root`) also works.

```ts
export const AgentStateSchema = new StateSchema({ messages: MessagesValue });
export type AgentState = StateOf<typeof AgentStateSchema>;

@LangGraph({ name: "weatherAgent", state: AgentStateSchema, tools: [WeatherTools] })
export class WeatherAgentGraph {
  edges = defineEdges<AgentState>([
    { from: START, to: CallModel },
    { from: CallModel, to: route<AgentState>(shouldContinue, [TOOLS, END]) },
    { from: TOOLS, to: CallModel },
  ]);
}
```

2. **Register** in a module: `LangGraphModule.forFeature([WeatherAgentGraph])`, and list every node and tool provider in `providers: [...]`. `LangGraphModule.forRoot({ checkpointer })` is imported **once** at the app root, not per feature.

3. **Consume** the compiled graph with `@InjectLangGraphRunnable(WeatherAgentGraph) agent: LangGraphRunnable<AgentState>`. Facade methods (`invoke`, `stream`/`streamValues`/`streamUpdates`/`streamMessages`/`streamModes`, `getState`, `updateState`, `resume`) — see the package README's "Facade API" and "Streaming" sections; don't reimplement streamMode handling.

## Subgraphs

Any `@LangGraph` class can be an edge target inside another graph — it compiles and mounts as a single node. Register **every** subgraph class alongside the parent in `forFeature([...])` and module `providers`; the registry resolves each one's `edges` from DI even though you typically inject only the parent facade. Subgraphs carry no checkpointer of their own — only the outermost graph does. See README "Subgraphs".

## Checkpointer

Configured only in `LangGraphModule.forRoot({ checkpointer: { type: "memory" } })` (default `MemorySaver`). Typed configs exist for `postgres` / `sqlite` / `mongodb` / `redis` — each is an **optional peer dependency**, loaded lazily; install only what you configure or bootstrap fails fast with the exact install command to run. `recursionLimit` is a per-graph default merged into every call. Full option shapes, ownership/teardown rules, escape hatches: README "Checkpointers".

## Modules

Prefer a schematic: `nest g module <name>`, then add the `LangGraphModule.forFeature([...])` import and providers by hand.

## Tests

Boot with `Test.createTestingModule` importing `forRoot()` + `forFeature([YourGraph])`, get the facade via `@InjectLangGraphRunnable` or `getGraphFacadeToken({ name })`, invoke, assert.

## Common Mistakes

- Forgetting to register a subgraph (or a node) in `forFeature`/`providers` — bootstrap throws "not resolvable from DI" or "not provided in any module".
- Giving a subgraph its own checkpointer, or importing `forRoot` more than once.
- Referencing `TOOLS` in edges without declaring `tools: [...]` — fail-fast at bootstrap.
- Duplicating README streaming/checkpointer detail into code instead of using the facade helpers.
- Bare `new Date()` in graph logic under test.
