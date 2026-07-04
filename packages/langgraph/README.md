# @harpua/langgraph

Idiomatic NestJS for LangGraph. Nodes are plain `@Injectable` providers, graphs
are typed edge lists, tools are decorated methods on ordinary services, and
dependency injection runs all the way down. State compatibility between a node
and the graph it's wired into is checked at **compile time** — a node that
touches state the graph doesn't provide is a TypeScript error, not a runtime
surprise.

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

This package ships [Claude Code](https://claude.com/claude-code) /
[agentskills.io](https://agentskills.io)-format skills under
`skills/adding-things/` — recipes for adding a tool, node, edge, graph, or
subgraph with this library. Wire them into a consuming project with
[`skills-npm`](https://www.npmjs.com/package/skills-npm) (`npx skills-npm`
symlinks skills from installed packages into your project's skill directory),
or manually by symlinking/copying
`node_modules/@harpua/langgraph/skills/adding-things` into your project's
`.claude/skills/`.
