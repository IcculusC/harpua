# @harpua/langgraph

Idiomatic NestJS for LangGraph. Nodes are plain `@Injectable` providers, graphs
are typed edge lists, tools are decorated methods on ordinary services, and
dependency injection runs all the way down. State compatibility between a node
and the graph it's wired into is checked at **compile time** — a node that
touches state the graph doesn't provide is a TypeScript error, not a runtime
surprise.

## Table of Contents

- [Install](#install)
- [The LangGraph quickstart, the Nest way](#the-langgraph-quickstart-the-nest-way)
- [Core concepts](#core-concepts)
  - [`NodeHandler` and state slices](#nodehandler-and-state-slices)
  - [`defineEdges`, `route`, `as`, and the sentinels](#defineedges-route-as-and-the-sentinels)
  - [Tools and the `TOOLS` node](#tools-and-the-tools-node)
  - [Give the model the graph's tools](#give-the-model-the-graphs-tools)
  - [Subgraphs](#subgraphs)
  - [Interrupts and `resume`](#interrupts-and-resume)
  - [Streaming](#streaming)
  - [Checkpointers](#checkpointers)
  - [OpenTelemetry tracing](#opentelemetry-tracing)
  - [Bootstrap fail-fast validation](#bootstrap-fail-fast-validation)
- [Agents and middleware](#agents-and-middleware)
  - [`@LangGraphAgent`](#langgraphagent)
  - [`@LangGraphMiddleware`](#langgraphmiddleware)
  - [Budget + Retry](#budget-retry)
  - [Context management](#context-management)
  - [`responseFormat`](#responseformat)
  - [Semantics: loop and exit reset per invoke by default](#semantics-loop-and-exit-reset-per-invoke-by-default)
- [Facade API](#facade-api)
- [Notes](#notes)
- [Agent skills](#agent-skills)

## Install

```bash
pnpm add @harpua/langgraph
```

Peer dependencies (bring your own versions):

```bash
pnpm add @langchain/langgraph @langchain/core zod @nestjs/common @nestjs/core
```

Requires Nest 11 and `@langchain/langgraph` / `@langchain/core` v1.

## The LangGraph quickstart, the Nest way

The canonical LangGraph JS example is a small ReAct-style weather agent: a
`get_weather` tool, a `callModel` node, a `ToolNode`, and a conditional edge
that loops back to the model until it stops calling tools.

```ts
// From the LangGraph JS docs (condensed):
import { StateGraph, StateSchema, MessagesValue } from "@langchain/langgraph";
import { ToolNode } from "@langchain/langgraph/prebuilt";
import { tool } from "@langchain/core/tools";
import { z } from "zod";

const getWeather = tool(
  (input) =>
    ["sf", "san francisco"].includes(input.location.toLowerCase())
      ? "It's 60 degrees and foggy."
      : "It's 90 degrees and sunny.",
  {
    name: "get_weather",
    description: "Call to get the current weather.",
    schema: z.object({ location: z.string() }),
  },
);

const AgentState = new StateSchema({ messages: MessagesValue });

const toolNode = new ToolNode([getWeather]);
const callModel = async (state: typeof AgentState.State) => {
  const response = await modelWithTools.invoke(state.messages);
  return { messages: response };
};
const shouldContinue = (state: typeof AgentState.State) => {
  const last = state.messages.at(-1);
  return "tool_calls" in last && last.tool_calls?.length ? "tools" : "__end__";
};

const graph = new StateGraph(AgentState)
  .addNode("agent", callModel)
  .addNode("tools", toolNode)
  .addEdge("__start__", "agent")
  .addConditionalEdges("agent", shouldContinue)
  .addEdge("tools", "agent")
  .compile();
```

Here's the same agent as an `@harpua/langgraph` graph. The tool is a method on
a provider, the model call is a `NodeHandler`, and the edges are a typed list
instead of a fluent builder. State is declared with the zod-based `StateSchema`
API shown above, but `@LangGraph({ state })` also accepts the older
`Annotation.Root`-style state objects (or a bare zod object schema) unchanged.

**`weather.tools.ts`** — a tool provider:

```ts
import { Injectable } from "@nestjs/common";
import { z } from "zod";
import { LangGraphTool } from "@harpua/langgraph";

@Injectable()
export class WeatherTools {
  @LangGraphTool({
    name: "get_weather",
    description: "Call to get the current weather.",
    schema: z.object({ location: z.string().describe("Location to get the weather for.") }),
  })
  getWeather(input: { location: string }): string {
    return ["sf", "san francisco"].includes(input.location.toLowerCase())
      ? "It's 60 degrees and foggy."
      : "It's 90 degrees and sunny.";
  }
}
```

**`call-model.node.ts`** — the model node. The library is model-agnostic: inject
your chat model however you like (a provider wrapping `ChatAnthropic`,
`ChatOpenAI`, a config-driven factory, whatever your app already uses).

```ts
import { Inject, Injectable } from "@nestjs/common";
import { isAIMessage } from "@langchain/core/messages";
import { StateSchema, MessagesValue } from "@langchain/langgraph";
import type { NodeHandler, StateOf } from "@harpua/langgraph";
import { TOOLS, END } from "@harpua/langgraph";
import { CHAT_MODEL, type ChatModel } from "./chat-model.provider";

export const AgentStateSchema = new StateSchema({ messages: MessagesValue });
export type AgentState = StateOf<typeof AgentStateSchema>;

@Injectable()
export class CallModel implements NodeHandler<AgentState> {
  constructor(@Inject(CHAT_MODEL) private readonly model: ChatModel) {}

  async run(state: AgentState) {
    const response = await this.model.invoke(state.messages);
    return { messages: [response] };
  }
}

export function shouldContinue(state: AgentState): typeof TOOLS | typeof END {
  const last = state.messages[state.messages.length - 1];
  return last && isAIMessage(last) && (last.tool_calls?.length ?? 0) > 0
    ? TOOLS
    : END;
}
```

**`weather-agent.graph.ts`** — the graph definition:

```ts
import { LangGraph, defineEdges, route, START, TOOLS, END } from "@harpua/langgraph";
import { AgentStateSchema, CallModel, shouldContinue, type AgentState } from "./call-model.node";
import { WeatherTools } from "./weather.tools";

@LangGraph({ name: "weatherAgent", state: AgentStateSchema, tools: [WeatherTools] })
export class WeatherAgentGraph {
  edges = defineEdges<AgentState>([
    { from: START, to: CallModel },
    { from: CallModel, to: route<AgentState>(shouldContinue, [TOOLS, END]) },
    { from: TOOLS, to: CallModel },
  ]);
}
```

**`weather.module.ts`** — wiring:

```ts
import { Module } from "@nestjs/common";
import { LangGraphModule } from "@harpua/langgraph";
import { WeatherAgentGraph } from "./weather-agent.graph";
import { CallModel } from "./call-model.node";
import { WeatherTools } from "./weather.tools";

@Module({
  imports: [
    LangGraphModule.forRoot({ checkpointer: { type: "memory" } }),
    LangGraphModule.forFeature([WeatherAgentGraph]),
  ],
  providers: [CallModel, WeatherTools],
})
export class WeatherModule {}
```

**`weather.service.ts`** — consuming the compiled graph:

```ts
import { Injectable } from "@nestjs/common";
import { HumanMessage } from "@langchain/core/messages";
import { InjectLangGraphRunnable, type LangGraphRunnable } from "@harpua/langgraph";
import { WeatherAgentGraph } from "./weather-agent.graph";
import type { AgentState } from "./call-model.node";

@Injectable()
export class WeatherService {
  constructor(
    @InjectLangGraphRunnable(WeatherAgentGraph)
    private readonly agent: LangGraphRunnable<AgentState>,
  ) {}

  ask(question: string, threadId: string) {
    return this.agent.invoke(
      { messages: [new HumanMessage(question)] },
      { configurable: { thread_id: threadId } },
    );
  }
}
```

`WeatherTools`'s `getWeather` method actually executes through Nest DI — it's
bound to the live provider instance, so it can inject any other service the
same way `CallModel` injects its chat model.

## Core concepts

### `NodeHandler` and state slices

A node declares only the slice of state it touches:

```ts
export interface NodeHandler<TState> {
  run(state: TState, config?: LangGraphRunnableConfig): Partial<TState> | Promise<Partial<TState>>;
}
```

Because the slice is just a TypeScript interface, the *same node class* can be
wired into multiple graphs whose composite state is a structural superset of
it — no adapter, no wrapping:

```ts
@Injectable()
class LogStamp implements NodeHandler<{ log: string[] }> {
  run(state: { log: string[] }) {
    return { log: [...state.log, "stamp"] };
  }
}

// GraphOneState = { log: string[]; alpha: string }
// GraphTwoState = { log: string[]; beta: number }
// LogStamp is valid in both graphs below — it only ever sees `log`.
```

This is enforced at compile time, not just documented by convention. Passing a
node into `defineEdges<TGraphState>` that requires state fields
`TGraphState` doesn't provide is a TypeScript error:

```ts
interface WideState { a: string; b: number }
interface NarrowState { a: string }

class WideNode implements NodeHandler<WideState> { run(_: WideState) { return {}; } }

defineEdges<NarrowState>([
  // @ts-expect-error WideNode requires 'b' which NarrowState does not provide.
  { from: START, to: WideNode },
]);
```

A narrower node dropped into a wider graph compiles fine (reuse); a node that
needs fields the graph's state doesn't have does not.

### `defineEdges`, `route`, `as`, and the sentinels

`defineEdges<TState>(edges)` is an identity function at runtime — its only job
is to type-check the edge list against `TState`. Each `GraphEdge` is
`{ from, to }`, where `from`/`to` can be `START`/`END` (re-exported from
`@langchain/langgraph`), `TOOLS` (this library's sentinel for the tool node),
a node class, an `as(...)` alias, or another `@LangGraph` class used as a
subgraph.

Conditional edges are built with `route`:

```ts
route<TState>(
  (state, config) => /* next target, or an array of targets */,
  [TOOLS, END], // optional pathMap: closed set, validated fail-fast at bootstrap
);
```

`as(alias, NodeClass)` lets one provider be mounted more than once in a graph
under distinct node ids:

```ts
edges = defineEdges<TrailStateT>([
  { from: START, to: as("first", Appender) },
  { from: as("first", Appender), to: as("second", Appender) },
  { from: as("second", Appender), to: END },
]);
```

### Tools and the `TOOLS` node

Tool methods are declared with `@LangGraphTool` on any `@Injectable`, and the
provider classes are listed in `@LangGraph({ tools: [...] })`. At bootstrap the
library resolves each provider from DI, binds its `@LangGraphTool` methods,
wraps them with `tool(...)`, and mounts them as a single `ToolNode` under the
`TOOLS` sentinel — reference `TOOLS` in your edges exactly like a node class.

The `tools` array also accepts **raw LangChain tool instances** (any
`StructuredToolInterface`, e.g. a `tool(...)` from `@langchain/core/tools` or a
prebuilt tool such as [`@harpua/agent-tools`](https://www.npmjs.com/package/@harpua/agent-tools)'
`thinkTool()`), mixed freely with provider classes:

```ts
import { thinkTool } from "@harpua/agent-tools";

@LangGraph({ name: "weatherAgent", state: AgentStateSchema, tools: [WeatherTools, thinkTool()] })
export class WeatherAgentGraph { /* … */ }
```

Raw instances are mounted into the same `ToolNode` as-is (and traced the same
way). Reach for a provider class when a tool needs DI; use a raw instance for
self-contained tools. An entry that is neither fails fast at bootstrap.

#### Approval-gated tools

A destructive tool can require human approval before it runs. Add
`requiresApproval: true` to the decorator — the framework pauses execution with
a `tool_approval_request` interrupt before the tool runs, and only executes it
after you resume with `{ approved: true }`:

```ts
import { z } from "zod";
import { LangGraphTool } from "@harpua/langgraph";

@Injectable()
export class OrderTools {
  constructor(private readonly orders: OrdersService) {}

  @LangGraphTool({
    name: "cancel_order",
    description: "Cancel an order by its id. Requires the user's approval.",
    schema: z.object({ orderId: z.string() }),
    requiresApproval: true, // ← pauses for approval before executing
  })
  cancelOrder(input: { orderId: string }): string {
    return this.orders.cancel(input.orderId);
  }
}
```

The **model-facing tool is identical** to an unflagged one — the model still
sees and calls it normally; only its execution is gated. When the model calls
it, the run pauses and surfaces
`{ type: "tool_approval_request", tool: "cancel_order", args: { orderId } }`;
resume the thread with the decision:

```ts
await graph.resume(threadId, { approved: true });               // runs the tool
await graph.resume(threadId, { approved: false, reason: "…" }); // declines; the tool
// never runs and returns "The user declined cancel_order: …" for the model to answer.
```

A raw LangChain tool instance uses the sibling marker `requireApproval(tool)`:

```ts
import { requireApproval } from "@harpua/langgraph";
import { tool } from "@langchain/core/tools";

const wipe = requireApproval(
  tool((input: { target: string }) => doWipe(input.target), {
    name: "wipe",
    description: "Wipe a target — destructive.",
    schema: z.object({ target: z.string() }),
  }),
);

@LangGraph({ name: "agent", state: AgentStateSchema, tools: [wipe] })
export class AgentGraph { /* … */ }
```

This is the primary human-in-the-loop pattern: a real model can call a tool but
can never set a mock-only side-channel field, so gating on the tool call is what
works with a live LLM. See [Interrupts and `resume`](#interrupts-and-resume) and
the `human-in-the-loop` skill for surfacing over HTTP/SSE/CLI.

### Give the model the graph's tools

The `TOOLS` node **executes** tool calls — but a real chat model only emits a
tool call if it was told the tools exist. Vanilla LangChain does this with
`model.bindTools([...])`; here the framework already knows every tool the graph
declares, so `provideGraphBoundModel` builds that exact array and binds it for
you. Point it at the graph and at **your own** model provider:

```ts
import { Module } from "@nestjs/common";
import { LangGraphModule, provideGraphBoundModel } from "@harpua/langgraph";

import { AgentGraph, CallModelNode } from "./agent.graph";
import { OrderTools } from "./order.tools";

// A token for your model, and a token for its tool-bound form.
export const MODEL = Symbol.for("app:MODEL");
export const BOUND_MODEL = Symbol.for("app:BOUND_MODEL");

@Module({
  imports: [LangGraphModule.forFeature([AgentGraph])],
  providers: [
    OrderTools,
    // Your model — any provider resolving to a BaseChatModel.
    { provide: MODEL, useValue: new ChatOpenRouter({ model: "…" }) },
    // Bind AgentGraph's tools to it; nodes inject BOUND_MODEL.
    provideGraphBoundModel({ provide: BOUND_MODEL, graph: AgentGraph, model: MODEL }),
    CallModelNode,
  ],
})
export class AgentModule {}
```

The node injects the bound token and calls it exactly like a model — the
binding is transparent:

```ts
import { Inject, Injectable } from "@nestjs/common";
import { NodeHandler, type GraphBoundModel } from "@harpua/langgraph";

import { BOUND_MODEL } from "./agent.module";

@Injectable()
export class CallModelNode implements NodeHandler<AgentState> {
  constructor(@Inject(BOUND_MODEL) private readonly model: GraphBoundModel) {}

  async run(state: AgentState) {
    return { messages: [await this.model.invoke(state.messages)] };
  }
}
```

`model` is **any** token you own — a `useValue`, a `useClass`, a `useFactory`,
a class token, a symbol, or a string — so this package never depends on any
particular model library. When the graph declares no tools, the model is
returned unchanged. The factory runs during instantiation and only reads the
graph's metadata and DI-resolves the tool providers, so it never races graph
compilation.

Want to bind manually (e.g. wrap the model yourself, or hand the tools to
something else)? Inject the raw array instead:

```ts
import { provideGraphTools, getGraphToolsToken } from "@harpua/langgraph";
import type { StructuredToolInterface } from "@langchain/core/tools";

// provider: publishes the array under getGraphToolsToken(AgentGraph)
provideGraphTools({ graph: AgentGraph });

// consumer:
constructor(
  @Inject(getGraphToolsToken(AgentGraph)) tools: StructuredToolInterface[],
) {}
```

`provideGraphBoundModel` is just this primitive composed with `bindTools`.

#### Works great with `@harpua/models`

The `model` token can be any `BaseChatModel` provider — including
[`@harpua/models`](https://www.npmjs.com/package/@harpua/models)' env-driven
`CHAT_MODEL`, which stays mock-by-default and flips to a real provider with one
env var:

```ts
import { CHAT_MODEL, ChatModelModule } from "@harpua/models";

imports: [ChatModelModule.forRoot()],
providers: [
  provideGraphBoundModel({ provide: BOUND_MODEL, graph: AgentGraph, model: CHAT_MODEL }),
],
```

Its `MockChatModel.bindTools` is a no-op that returns itself, so mock-mode flows
are unchanged; a real model receives the tools and can emit the calls the
`TOOLS` node runs.

### Subgraphs

A `@LangGraph` class can appear as an edge target inside another graph — it's
compiled and mounted as a single node:

```ts
@LangGraph({ name: "childOne", state: TrailState })
class ChildOne {
  edges = defineEdges<TrailStateT>([{ from: START, to: StepOne }, { from: StepOne, to: END }]);
}

@LangGraph({ name: "parent", state: TrailState })
class ParentGraph {
  edges = defineEdges<TrailStateT>([
    { from: START, to: ChildOne },
    { from: ChildOne, to: ChildTwo },
    { from: ChildTwo, to: END },
  ]);
}
```

Register every subgraph class alongside the parent in `forFeature([...])` —
the registry needs to resolve each one's `edges` from DI, even though only the
parent's facade is typically injected. Subgraphs compile without their own
checkpointer; only the outermost graph carries one.

### Interrupts and `resume`

Call `interrupt(value)` (re-exported from `@langchain/langgraph`) inside a
node to pause the run — the invoke call returns with `__interrupt__` set
instead of finishing:

```ts
@Injectable()
class AskHumanNode implements NodeHandler<HilStateT> {
  run(state: HilStateT) {
    const provided = interrupt(state.question);
    return { answer: String(provided) };
  }
}
```

Resume it through the facade rather than hand-building a `Command`:

```ts
const paused = await hil.invoke({ question: "...", answer: "" }, { configurable: { thread_id } });
// paused.__interrupt__ is set
const done = await hil.resume(thread_id, "Ada");
```

`resume(threadId, value, config?)` is sugar for
`invoke(new Command({ resume: value }), { ...config, configurable: { thread_id } })`.

### Streaming

`invoke` runs the graph to completion; streaming lets you observe it super-step
by super-step. The facade exposes a typed helper per LangGraph `streamMode`, so
you never hand-write `streamMode` strings or untangle `[mode, chunk]` tuples.
All of them share `invoke`'s ergonomics — an ephemeral `thread_id` is filled in
when you omit one, and the graph's default `recursionLimit` is merged the same
way.

Every helper returns a `Promise<AsyncIterable<…>>`, so the shape is
`for await (const chunk of await agent.streamX(input, config))`.

```ts
// updates (the default): one chunk per super-step, keyed by node id ->
// the partial state that node returned. `stream` and `streamUpdates` are equal.
for await (const update of await agent.stream(input, cfg)) {
  // e.g. { CallModel: { messages: [AIMessage] } }  then  { tools: { messages: [ToolMessage] } }
  const [node, patch] = Object.entries(update)[0];
}

// values: the full TState snapshot after each step (plus the initial input state).
for await (const state of await agent.streamValues(input, cfg)) {
  // state is the whole TState
}

// messages: LLM message/token chunks as [message, metadata]. Token-level
// streaming needs a real streaming chat model; a node that returns a whole
// AIMessage still surfaces it here as one chunk.
for await (const [message, metadata] of await agent.streamMessages(input, cfg)) {
  process.stdout.write(typeof message.content === "string" ? message.content : "");
}

// several modes at once -> a typed, discriminated [mode, chunk] union.
for await (const chunk of await agent.streamModes(input, ["updates", "values"], cfg)) {
  if (chunk[0] === "values") { /* chunk[1]: TState */ }
  else { /* chunk[1]: NodeUpdate<TState> */ }
}
```

What each mode yields:

| Mode | Helper | Chunk shape |
|---|---|---|
| `updates` (default) | `stream` / `streamUpdates` | `{ [nodeId]: Partial<TState> }` — one per super-step |
| `values` | `streamValues` | the whole `TState`, once per step (starting with the input state) |
| `messages` | `streamMessages` | `[BaseMessage, metadata]` for each emitted message/token |
| any combination | `streamModes` | `[mode, chunk]` tuples, typed as a union of the requested modes |

#### Interrupts during a stream

When a node calls `interrupt()` mid-stream, the run does **not** throw and does
**not** silently stop — it emits one final chunk carrying the interrupt and then
the stream ends. In both `updates` and `values` mode that terminator has the
shape `{ __interrupt__: [{ id, value }] }`. Detect it with `getStreamedInterrupts`
and continue with `resume()`:

```ts
import { getStreamedInterrupts } from "@harpua/langgraph";

let pending: unknown;
for await (const chunk of await hil.streamUpdates(input, { configurable: { thread_id } })) {
  const interrupts = getStreamedInterrupts(chunk);
  if (interrupts) { pending = interrupts[0].value; break; } // graph is paused
  // ...handle the normal node update
}

if (pending !== undefined) {
  const done = await hil.resume(thread_id, answerFromHuman);
}
```

`getStreamedInterrupts(chunk)` returns the `StreamInterrupt[]` when a chunk is
the interrupt terminator, otherwise `undefined`.

### Checkpointers

Every compiled graph is given a checkpointer (interrupts require one).
Configure it in `LangGraphModule.forRoot`:

```ts
LangGraphModule.forRoot({ checkpointer: { type: "memory" } }); // MemorySaver, the default
```

#### Typed configs for the official savers

First-class, typed configs wire up the official LangGraph JS checkpoint savers
directly, shaped to each package's real construction API:

```ts
// Postgres — @langchain/langgraph-checkpoint-postgres
LangGraphModule.forRoot({
  checkpointer: { type: "postgres", connectionString: "postgres://…", schema: "public" },
});
LangGraphModule.forRoot({
  checkpointer: { type: "postgres", pool: myPgPool, schema: "public" }, // bring your own pg.Pool
});

// SQLite — @langchain/langgraph-checkpoint-sqlite
LangGraphModule.forRoot({ checkpointer: { type: "sqlite", path: "./checkpoints.db" } });
LangGraphModule.forRoot({ checkpointer: { type: "sqlite", path: ":memory:" } });

// MongoDB — @langchain/langgraph-checkpoint-mongodb
LangGraphModule.forRoot({
  checkpointer: { type: "mongodb", url: "mongodb://localhost:27017", dbName: "app" },
});
LangGraphModule.forRoot({
  checkpointer: { type: "mongodb", client: myMongoClient, dbName: "app" }, // bring your own MongoClient
});

// Redis — @langchain/langgraph-checkpoint-redis
LangGraphModule.forRoot({ checkpointer: { type: "redis", url: "redis://localhost:6379" } });
LangGraphModule.forRoot({
  checkpointer: { type: "redis", client: myRedisClient, ttl: { defaultTTL: 3600 } }, // bring your own client
});
```

#### Optional peer dependencies — install only what you use

The four saver packages are **optional peer dependencies**. `@harpua/langgraph`
never imports them at module load; each driver is loaded lazily, in a `try/catch`,
only inside the factory for its `type`. Install only the one(s) you configure:

```bash
pnpm add @langchain/langgraph-checkpoint-postgres   # for { type: "postgres" }
pnpm add @langchain/langgraph-checkpoint-sqlite     # for { type: "sqlite" }
pnpm add @langchain/langgraph-checkpoint-mongodb    # for { type: "mongodb" }
pnpm add @langchain/langgraph-checkpoint-redis      # for { type: "redis" }
```

Configure a `type` whose package isn't installed and bootstrap fails fast with
the exact package name and the `pnpm add …` command to run.

#### Setup and teardown lifecycle

Savers that need schema/index setup have it awaited during bootstrap **before any
graph compiles**: `PostgresSaver.setup()` and `MongoDBSaver.setup()` are called for
you, and `RedisSaver.fromUrl(...)` builds its indexes on connect. SQLite sets up its
table lazily on first use. You never call `setup()` yourself.

Connections the **module** creates (from a `connectionString` / `url` / `path`) are
closed on `onApplicationShutdown` — the Postgres pool and Redis client via their
`end()`, the module-created Mongo client via `close()`, and the SQLite database via
`close()`. Enable shutdown hooks so this fires on process signals in production:

```ts
const app = await NestFactory.create(AppModule);
app.enableShutdownHooks();
```

#### Ownership rule

Connections you pass in yourself — a `pool`, a Mongo/Redis `client` — are **never
closed by the module**. You created them, so you own their lifecycle. Only
module-created connections are torn down for you.

#### Escape hatches

Any `BaseCheckpointSaver` can still be plugged in through the DI container:

```ts
LangGraphModule.forRoot({ checkpointer: { useExisting: PostgresSaverProvider } });
// or
LangGraphModule.forRoot({
  checkpointer: { useFactory: (cfg: ConfigService) => new SomeSaver(cfg.get("dsn")), inject: [ConfigService] },
});
```

### OpenTelemetry tracing

Compiled graphs emit OpenTelemetry spans through `@opentelemetry/api` — an
**optional** peer dependency. When it resolves, every run produces a
`langgraph.graph <name>` span with a child `langgraph.node <id>` span per node
and a `langgraph.tool <name>` span per tool call under the `tools` node; failures
set the span to `error` and record the exception. Because `@opentelemetry/api` is
a no-op until an SDK is registered, this is always-on and free until you wire a
`TracerProvider`, and silently absent if the package isn't installed. Only
names/ids and `thread_id` are recorded — never message contents or tool args.
Streaming keeps the graph span open until the async iterator is fully consumed.

Register any OTel SDK (e.g. `@opentelemetry/sdk-node`) at process start to
collect them; add `@langfuse/otel`'s `LangfuseSpanProcessor` to that SDK to ship
them to Langfuse — no Langfuse code lives in this library. Full wiring, the
attribute scheme, and an `InMemorySpanExporter` test recipe are in
`skills/graph-operations/references/observability.md`.

### Bootstrap fail-fast validation

Graphs are built and compiled once, during `onApplicationBootstrap`, from the
Nest DI container — no filesystem/decorator scanning. Structural problems
throw immediately at startup instead of surfacing mid-request:

- A class passed to `LangGraphModule.forFeature` / `InjectLangGraphRunnable` is not `@LangGraph`-decorated.
- A registered graph class isn't resolvable from DI (wasn't actually provided via `forFeature`).
- A graph class doesn't expose an `edges` array.
- A node class referenced by an edge is not provided in any module.
- A resolved node instance doesn't implement `run()`.
- Two different node classes are mapped to the same node id (use `as()` to alias one).
- An edge references `TOOLS` but the graph declares no `tools` providers.
- A listed tool provider isn't provided in any module.
- A listed tool provider exposes no `@LangGraphTool` methods.
- A circular subgraph reference is detected while compiling.
- An edge or route/interrupt target isn't a recognized reference (sentinel, node class, alias, or subgraph class).

## Agents and middleware

The graphs above are hand-wired: you write the `CallModel` node, the routing
function, and the `TOOLS` edge yourself. `@LangGraphAgent` is a preset
decorator for the common case — a model that loops with its tools until it's
done — that lowers to exactly those same primitives, plus an onion of
middleware hooks around the model and tool calls.

### `@LangGraphAgent`

A minimal agent needs a `name`, a `state`, a `model` token, and its `tools`:

```ts
import { StateSchema, MessagesValue } from "@langchain/langgraph";
import { LangGraphAgent } from "@harpua/langgraph";
import { CHAT_MODEL } from "./chat-model.provider";
import { WeatherTools } from "./weather.tools";

const AgentState = new StateSchema({ messages: MessagesValue });

@LangGraphAgent({
  name: "weatherAgent",
  state: AgentState,
  model: CHAT_MODEL,
  tools: [WeatherTools],
})
export class WeatherAgent {}
```

Register and inject it exactly like a hand-written `@LangGraph` class —
`LangGraphModule.forFeature([WeatherAgent])`, `@InjectLangGraphRunnable(WeatherAgent)`
— because that's what it compiles to. `@LangGraphAgent` generates the
`CallModel`/`TOOLS` node topology, assigns the `edges` array the
`GraphRegistry` reads, and applies the underlying `@LangGraph` decorator for
you; nothing about it is a black box; you can always eject to a hand-written
graph later and the wiring looks the same. The one thing it adds to your
`state` that a hand-written graph wouldn't have: two reserved, merged
channels, `loop` and `exit` (see [Semantics](#semantics-loop-and-exit-reset-per-invoke-by-default)
below), so `res.loop` and `res.exit` are present on every invoke result
alongside the fields you declared.

### `@LangGraphMiddleware`

A middleware is a `@LangGraphMiddleware()`-decorated, DI-injectable class
implementing `LangGraphMiddlewareContract`. It can implement either or both
kinds of hook:

- **Node hooks** — `beforeAgent` / `beforeModel` / `afterModel` / `afterAgent`
  — are inserted as real graph nodes around the loop's model call. Each
  receives a `ctx: MiddlewareContext<S>` and returns `Partial<S> | void`: a
  patch merges into state the same way any node's return value does; `void`
  is a no-op; `ctx.exit(meta)` returns a state patch that flags the thread as
  exited and routes the loop to its canonical end (through the
  `StructuredResponseNode` when `responseFormat` is set).
- **Wrap hooks** — `wrapModelCall` / `wrapToolCall` — are composed *around*
  the bound model call / each tool call, `(request, next) => Promise<...>`,
  like a Nest interceptor. `wrapModelCall` receives a `ModelRequest` whose
  `messages` and `model` are mutable properties (rewrite either before
  calling `next(req)`); `wrapToolCall` receives a `ToolRequest` (`name`,
  `args`, `id`, `state`). Wrap hooks compose onion-style (first in the
  `middleware` array is outermost), and each hook receives the request **as
  constructed by the hook outside it** — an outer sibling's appended
  `SystemMessage` or trimmed history is what the inner hook sees. That makes
  gating on "the last message is a `HumanMessage`" unsafe under composition
  (an outer sibling's trailer hides the human turn and the inner hook
  silently never fires); gate turn-start work on the exported
  `lastNonSystemIsHuman(req.messages)` instead.

`MiddlewareContext<S>` gives node hooks: `state` (`Readonly<S>`), `loop`
(the `LoopInfo` counters below), `config` (the run's `LangGraphRunnableConfig`),
`now()` (an injectable clock — never call `Date.now()` directly in a hook),
`interrupt(payload)`, and `exit(meta?)`.

Here's a small custom middleware — a `wrapModelCall` that trims the message
history sent to the model:

```ts
import { Injectable } from "@nestjs/common";
import { LangGraphMiddleware } from "@harpua/langgraph";
import type {
  LangGraphMiddlewareContract,
  ModelRequest,
  ModelNext,
} from "@harpua/langgraph";
import type { AIMessage } from "@langchain/core/messages";

const KEEP_LAST = 20;

@LangGraphMiddleware()
export class TrimMessages implements LangGraphMiddlewareContract {
  wrapModelCall(req: ModelRequest<any>, next: ModelNext): Promise<AIMessage> {
    if (req.messages.length > KEEP_LAST) {
      req.messages = req.messages.slice(-KEEP_LAST);
    }
    return next(req);
  }
}
```

This has to be a **wrap hook, not a node hook**. `messages` is a
`MessagesValue` channel — an append-only reducer — so a node hook returning
`{ messages: trimmed }` would *append* `trimmed` on top of the existing
history instead of replacing it, growing the very history you're trying to
shrink. `wrapModelCall`'s `req.messages` is the literal array about to be
sent to `model.invoke`, not a state patch, so reassigning it actually
replaces what the model sees on this turn.

Wire middleware into the agent as an array — order is the onion, first
entry outermost:

```ts
@LangGraphAgent({
  name: "weatherAgent",
  state: AgentState,
  model: CHAT_MODEL,
  tools: [WeatherTools],
  middleware: [TrimMessages],
})
export class WeatherAgent {}
```

### Budget + Retry

Two ready-made middlewares ship with the package:

- **`provideBudget({ maxCycles, maxToolCalls, maxTokens, maxWallMs, reset? })`** — a
  graceful loop guard; its `beforeModel` hook calls `ctx.exit({ reason: "budget:<cap>" })`
  the moment any one of the four caps is reached — `budget:cycles`,
  `budget:tool-calls`, `budget:tokens`, or `budget:wall`, in that precedence
  order when several trip at once (match with `startsWith("budget")` if you
  don't care which). It's the soft counterpart
  to LangGraph's hard `recursionLimit` throw. **`reset` defaults to `"invoke"`
  — a behavior change**: `BudgetMiddleware`'s `beforeAgent` hook now resets
  `loop`/`exit` back to their defaults at the start of every invoke, so a
  long-lived thread no longer accumulates turn over turn into a permanent
  exit. Pass `reset: "thread"` to restore the previous lifetime semantics
  (`loop`/`exit` persist and accumulate across every invoke on the same
  thread) — useful for a hard spend ceiling across a whole thread's
  lifetime; see [Semantics](#semantics-loop-and-exit-reset-per-invoke-by-default)
  for the `clearAgentExit()` escape hatch that mode needs. The reset works
  regardless of where Budget sits in the `middleware` array — the whole
  beforeAgent segment runs before the exit flag routes — but if one of your
  own middlewares calls `ctx.exit()` from a `beforeAgent` hook, list
  `BudgetMiddleware` first so its reset can't clear that fresh exit.
- **`provideRetry({ maxRetries, retryable, backoff })`** — wraps *both*
  `wrapModelCall` and `wrapToolCall` with the same retry loop: it re-invokes
  `next` while `retryable(err)` returns true, awaiting `backoff(attempt)`
  between attempts, up to `maxRetries`.

List the middleware classes in the agent's `middleware: [...]` array, and
register their option providers in the **same `forFeature` call**:

```ts
import { Module } from "@nestjs/common";
import {
  LangGraphModule,
  provideBudget,
  provideRetry,
  BudgetMiddleware,
  RetryMiddleware,
} from "@harpua/langgraph";
import { WeatherAgent } from "./weather-agent";
import { WeatherTools } from "./weather.tools";

@Module({
  imports: [
    LangGraphModule.forRoot(),
    LangGraphModule.forFeature([WeatherAgent], {
      providers: [
        ...provideBudget({
          maxCycles: 10,
          maxToolCalls: 20,
          maxTokens: 50_000,
          maxWallMs: 60_000,
        }),
        ...provideRetry({
          maxRetries: 2,
          retryable: () => true,
          backoff: async () => {},
        }),
      ],
    }),
  ],
  providers: [WeatherTools],
})
export class WeatherModule {}
```

```ts
@LangGraphAgent({
  name: "weatherAgent",
  state: AgentState,
  model: CHAT_MODEL,
  tools: [WeatherTools],
  middleware: [BudgetMiddleware, RetryMiddleware], // Budget outermost, Retry innermost
})
export class WeatherAgent {}
```

`provideBudget`/`provideRetry` each return a `Provider[]` — an options
provider (parsed with the middleware's zod schema) plus the middleware class
itself. Both must live in `forFeature`'s own `{ providers }`, not the app
root: the agent's compiled graph resolves `BudgetMiddleware`/`RetryMiddleware`
from that **same feature module's** DI scope, and a sibling registration at
the root `providers:` level is a different, non-importing module the graph
can't see into.

### Context management

Long-running threads eventually blow the model's context window. Three more
ready-made middlewares manage that — a fold that durably shrinks state, a
view that renders what the model sees this turn, and a bundle over both:

- **`provideCompaction({ triggerAt, keepRecent, pin?, strategy? })` →
  `CompactionMiddleware`** — the fold. A `beforeModel` hook that durably
  shrinks the checkpointed `messages` channel with `RemoveMessage` once
  `triggerAt` fires, keeping only a pinned head and a recent tail of
  `keepRecent` messages. Hysteresis snaps the cut forward to the next
  `HumanMessage`, so a retained history never opens on an orphaned
  `ToolMessage`.
- **`provideContextWindow({ cacheHints?, evictToolOutputs?, evictBeyond?, pin? })`
  → `ContextWindowMiddleware`** — the view. A `wrapModelCall` hook that
  assembles `[pinned head · summary · tail]` for this turn, stamps
  provider-agnostic cache boundaries onto it, and can optionally elide old
  tool outputs. It never mutates checkpointed state (copy-on-write); the fold
  above is the only thing that durably shrinks `messages`.
- **`provideManagedContext({ triggerAt, keepRecent, pin?, strategy?, cacheHints?, evictToolOutputs?, evictBeyond? })`
  → `ManagedContextMiddleware`** — the recommended path: one entry that
  delegates to both of the above for you.

Wire it exactly like Budget/Retry — list the middleware class in the agent's
`middleware: [...]` array, and register its option provider in the **same
`forFeature` call**:

```ts
import { Module } from "@nestjs/common";
import {
  LangGraphModule,
  provideManagedContext,
  ManagedContextMiddleware,
} from "@harpua/langgraph";
import { WeatherAgent } from "./weather-agent";
import { WeatherTools } from "./weather.tools";

@Module({
  imports: [
    LangGraphModule.forRoot(),
    LangGraphModule.forFeature([WeatherAgent], {
      providers: [
        ...provideManagedContext({
          triggerAt: { messages: 40 },
          keepRecent: 20,
        }),
      ],
    }),
  ],
  providers: [WeatherTools],
})
export class WeatherModule {}
```

```ts
@LangGraphAgent({
  name: "weatherAgent",
  state: AgentState,
  model: CHAT_MODEL,
  tools: [WeatherTools],
  middleware: [ManagedContextMiddleware],
})
export class WeatherAgent {}
```

`provideCompaction`/`provideContextWindow`/`provideManagedContext` all accept
**partial option literals** — omitted fields fill in from defaults.
`triggerAt` is one of `{ tokens: N }`, `{ messages: N }`, or a predicate
`(signal) => boolean`; `keepRecent` is the message count kept as the tail
(snapped to a `HumanMessage` boundary); `pin` is a predicate for the retained
head and defaults to the first `HumanMessage`.

`strategy` defaults to `"drop"` — `RemoveMessage` the folded span, no
summary, no model call: free and lossy, and the right call when the durable
facts you need already live somewhere else (a database, other state
channels). Opt into `strategy: { kind: "summarize", model: CHAT_MODEL, schema? }`
to have the fold call `model.withStructuredOutput(schema)` (defaulting to the
package's own summary schema) over the discarded span before removing it; a
summarizer error is logged as a warning and that fold silently falls back to
`drop`.

**A discrete `CompactionMiddleware` with `strategy: "summarize"` but no
`ContextWindowMiddleware` writes a summary that nothing renders into the
prompt** — the fold only ever removes messages from state; assembling
`[head · summary · tail]` back into what the model actually sees is the
view's job. That combination is strictly worse than `drop` (you pay for a
model call and get nothing back for it). Whenever `strategy` is
`"summarize"`, reach for `ManagedContextMiddleware`, or pair
`CompactionMiddleware` with `ContextWindowMiddleware` explicitly.

**Cache locality**: the byte-stable `[head · summary · tail]` layout is
itself the whole optimization for providers that auto-cache off a stable
prompt prefix (OpenAI, OpenRouter, DeepSeek) — no config needed. For
Anthropic, `ContextWindowMiddleware` additionally translates its boundary
markers into explicit `cache_control` blocks; this is on by default
(`cacheHints: true`) and a no-op for every other provider.

### `responseFormat`

Give the agent a zod schema and its final answer is coerced into a typed
`outcome` state channel:

```ts
import { z } from "zod";

const Outcome = z.object({ status: z.string(), reason: z.string() });

@LangGraphAgent({
  name: "weatherAgent",
  state: AgentState,
  model: CHAT_MODEL,
  tools: [WeatherTools],
  responseFormat: Outcome,
})
export class WeatherAgent {}
```

```ts
const res = await agent.invoke({ messages: [new HumanMessage("...")] });
res.outcome; // { status: string; reason: string }
```

Setting `responseFormat` adds an `outcome` channel to the merged state and
compiles in a `StructuredResponseNode` that calls the model's
`withStructuredOutput(schema)` on the way out — including when a middleware's
`ctx.exit()` short-circuits the loop early (e.g. `BudgetMiddleware` hitting a
cap still produces a schema-shaped `outcome`, not a bare early return).

### Semantics: loop and exit reset per invoke by default

The `loop` counters (`iteration`, `modelCalls`, `toolCalls`, `tokens`,
`startedAt`) and the `exit` flag are ordinary `LastValue` state channels, so
like the rest of state they're checkpointed: **nothing resets them by itself**
just because a new `invoke` starts on the same `thread_id`. Something has to
reset them, and `BudgetMiddleware` is what does.

`BudgetMiddleware` defaults to **`reset: "invoke"`** — its `beforeAgent` hook
zeroes the `loop` counters and clears a stuck `exit` at the start of every
invoke. So with the default budget in place, caps are per-invoke and a
long-lived thread does not accumulate turn over turn toward a permanent exit.
This is what you want for a chat thread.

The lifetime-accumulation semantics apply when `BudgetMiddleware` is
configured with **`reset: "thread"`** — a hard spend ceiling across a whole
thread — or when nothing manages these channels at all:

- Budget caps are **per-thread-lifetime**, not per-invoke: `loop.iteration`
  and friends keep climbing turn over turn *and* invoke over invoke on the
  same thread.
- Once a thread has exited (`exit.requested === true`, set by a middleware's
  `ctx.exit()`), a later re-invoke on that **same** thread stays exited —
  clear it with `clearAgentExit()` and `updateState`, or start a new
  `thread_id` for a fresh run:

```ts
import { clearAgentExit } from "@harpua/langgraph";

await agent.updateState({ configurable: { thread_id } }, clearAgentExit());
```

## Facade API

`@InjectLangGraphRunnable(GraphDef)` injects a `LangGraphRunnable<TState>`:

| Method | Signature | Notes |
|---|---|---|
| `invoke` | `(input, config?) => Promise<TState>` | Runs the graph to completion (or to the next interrupt). |
| `stream` | `(input, config?) => Promise<AsyncIterable<NodeUpdate<TState>>>` | Streams in the default `updates` mode: one per-node update per super-step. |
| `streamValues` | `(input, config?) => Promise<AsyncIterable<TState>>` | Streams full state snapshots (`values` mode). |
| `streamUpdates` | `(input, config?) => Promise<AsyncIterable<NodeUpdate<TState>>>` | Streams per-node partial updates (`updates` mode); explicit form of `stream`. |
| `streamMessages` | `(input, config?) => Promise<AsyncIterable<[BaseMessage, metadata]>>` | Streams LLM message/token chunks (`messages` mode). |
| `streamModes` | `(input, modes, config?) => Promise<AsyncIterable<[mode, chunk]>>` | Streams several modes at once with a typed `[mode, chunk]` union. |
| `getState` | `(config) => Promise<StateSnapshot>` | Reads the checkpointed state for a thread. |
| `getStateHistory` | `(config, options?) => AsyncIterableIterator<StateSnapshot>` | Streams a thread's checkpoint history, newest first — the time-travel primitive. Each snapshot's `config.configurable.checkpoint_id` can be replayed via `invoke({ configurable: { thread_id, checkpoint_id } })` to fork from that point. Same `thread_id` semantics as `getState` (no ephemeral default). |
| `updateState` | `(config, values, asNode?) => Promise<RunnableConfig>` | Writes into the checkpoint as if a given node produced `values`. |
| `resume` | `(threadId, resumeValue, config?) => Promise<TState>` | Sugar for `invoke(new Command({ resume }), ...)` against `threadId`. |

`thread_id` semantics: every compiled graph carries a checkpointer, so
`invoke`/`stream` technically require a `configurable.thread_id`. The facade
generates a random ephemeral one for you whenever `config.configurable.thread_id`
is omitted, so stateless call sites don't need to think about threads at all —
pass one explicitly only when you want persistence or plan to `resume` later.

## Notes

- **Module format**: the package builds to CommonJS (matching Nest 11's own
  build output), with declaration files and source maps.
- **Node scope**: nodes are resolved from the root DI container once, at
  bootstrap, and reused for every invocation — they must be singleton-scoped
  providers. There is no per-request node instantiation. If you need
  request-scoped context inside a node, thread it through the graph state
  itself or through `config.configurable` on the call (the same channel
  `thread_id` already travels on), not through DI request scope.
- **Recursion limits**: `@LangGraph({ recursionLimit })` sets a per-graph
  default that the facade merges into every `invoke`/`stream` call
  automatically. A `recursionLimit` passed explicitly in the call's `config`
  always takes precedence over the graph default.

## Agent skills

This package ships [agentskills.io](https://agentskills.io)-format skills
under `skills/graph-operations/` — recipes for adding a tool, node, edge,
graph, or subgraph with this library. The format is an open standard
supported by [Claude Code](https://claude.com/claude-code),
[OpenAI Codex](https://developers.openai.com/codex/skills), and other agents;
both follow symlinks.

### Recommended: the `harpua-skills` bin

The package installs a `harpua-skills` bin that discovers the skills shipped by
every installed `@harpua/*` package and links each into both `.claude/skills/`
and `.agents/skills/` from your project root. It is idempotent and safe: a
correct link is left alone, a stale/broken symlink is replaced, and a real
directory you own is never clobbered (it warns and continues). Wire it as a
`prepare` script so it re-runs on every install:

```jsonc
// package.json
{
  "scripts": {
    "prepare": "harpua-skills"
  }
}
```

Or run it once, ad hoc:

```bash
pnpm exec harpua-skills   # or: npx harpua-skills
```

### Fallback: manual symlinks

If you'd rather not run the bin, wire each skill by hand from your project root:

```bash
# Claude Code
mkdir -p .claude/skills && ln -s ../../node_modules/@harpua/langgraph/skills/graph-operations .claude/skills/graph-operations

# Codex (also honors the user-level ~/.agents/skills)
mkdir -p .agents/skills && ln -s ../../node_modules/@harpua/langgraph/skills/graph-operations .agents/skills/graph-operations
```

[`skills-npm`](https://www.npmjs.com/package/skills-npm) (`npx skills-npm`)
automates the same symlinking from installed packages, or copy the directory
outright if you prefer vendoring.
