# Adding a graph, subgraph, module, or checkpointer

A graph is a class decorated with `@LangGraph({ name, state, tools?, recursionLimit? })` exposing an `edges` array. Graphs are built and compiled once at `onApplicationBootstrap` from the DI container.

## Steps: a new graph

1. **Declare state.** Canonical for message/agent graphs: `new StateSchema({ messages: MessagesValue })`, then `type S = StateOf<typeof Schema>`. Any bare zod object (or `Annotation.Root`) also works. Exemplar: `apps/api/src/chat/chat.graph.ts`.

```ts
export const ChatMessagesState = new StateSchema({ messages: MessagesValue });
export type ChatState = StateOf<typeof ChatMessagesState>;

@LangGraph({ name: "chat", state: ChatMessagesState, tools: [OrderTools], recursionLimit: 10 })
export class ChatGraph {
  edges = defineEdges<ChatState>([
    { from: START, to: CallModelNode },
    { from: CallModelNode, to: route<ChatState>(routeAfterModel, [TOOLS, ApprovalNode, END]) },
    { from: TOOLS, to: CallModelNode },
    { from: ApprovalNode, to: END },
  ]);
}
```

2. **Register** in a module: `LangGraphModule.forFeature([ChatGraph])`, and list every node and tool provider in `providers: [...]`. Exemplar: `apps/api/src/chat/chat.module.ts`. `LangGraphModule.forRoot({ checkpointer })` is imported **once** at the app root, not per feature.

3. **Consume** the compiled graph with `@InjectLangGraphRunnable(ChatGraph) graph: LangGraphRunnable<ChatState>`. Facade methods (`invoke`, `stream`/`streamValues`/`streamUpdates`/`streamMessages`/`streamModes`, `getState`, `updateState`, `resume`) — see README "Facade API" and "Streaming"; don't reimplement streamMode handling. Exemplar consumer: `apps/api/src/chat/chat.service.ts`.

## Subgraphs

Any `@LangGraph` class can be an edge target inside another graph — it compiles and mounts as a single node. Register **every** subgraph class alongside the parent in `forFeature([...])` and module `providers`; the registry resolves each one's `edges` from DI even though you typically inject only the parent facade. Subgraphs carry no checkpointer of their own — only the outermost graph does. See README "Subgraphs" and `__tests__/subgraph.spec.ts`.

## Checkpointer

Configured only in `LangGraphModule.forRoot({ checkpointer: { type: "memory" } })` (default `MemorySaver`). Typed configs exist for `postgres` / `sqlite` / `mongodb` / `redis` — each is an **optional peer dependency**, loaded lazily; install only what you configure or bootstrap fails fast with the `pnpm add` command. `recursionLimit` is a per-graph default merged into every call. Full option shapes, ownership/teardown rules, escape hatches: README "Checkpointers". Wrapping a new optional driver? Follow the pattern in `packages/langgraph/src/checkpointer.ts` (see `references/package.md`).

## Modules

Prefer a schematic: `pnpm --filter @harpua/api exec nest g module <name>`, then add the `LangGraphModule.forFeature([...])` import and providers by hand.

## Tests

Boot with `Test.createTestingModule` importing `forRoot()` + `forFeature([Graph])`, get the facade via `@InjectLangGraphRunnable` or `getGraphFacadeToken({ name })`, invoke, assert. Exemplars: `__tests__/agentic.spec.ts`, `linear.spec.ts`, `subgraph.spec.ts`. App-level: `chat.e2e.spec.ts`.

## Common Mistakes

- Forgetting to register a subgraph (or a node) in `forFeature`/`providers` — bootstrap throws "not resolvable from DI" or "not provided in any module".
- Giving a subgraph its own checkpointer, or importing `forRoot` more than once.
- Referencing `TOOLS` in edges without declaring `tools: [...]` — fail-fast at bootstrap.
- Duplicating README streaming/checkpointer detail into code instead of using the facade helpers.
- Verifying per-package instead of the root protocol; bare `new Date()` in graph logic under test.
