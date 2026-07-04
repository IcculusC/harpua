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
import { StateGraph, MessagesAnnotation } from "@langchain/langgraph";
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

const toolNode = new ToolNode([getWeather]);
const callModel = async (state: typeof MessagesAnnotation.State) => {
  const response = await modelWithTools.invoke(state.messages);
  return { messages: response };
};
const shouldContinue = (state: typeof MessagesAnnotation.State) => {
  const last = state.messages.at(-1);
  return "tool_calls" in last && last.tool_calls?.length ? "tools" : "__end__";
};

const graph = new StateGraph(MessagesAnnotation)
  .addNode("agent", callModel)
  .addNode("tools", toolNode)
  .addEdge("__start__", "agent")
  .addConditionalEdges("agent", shouldContinue)
  .addEdge("tools", "agent")
  .compile();
```

Here's the same agent as an `@harpua/langgraph` graph. The tool is a method on
a provider, the model call is a `NodeHandler`, and the edges are a typed list
instead of a fluent builder.

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
import { isAIMessage, type BaseMessage } from "@langchain/core/messages";
import type { NodeHandler } from "@harpua/langgraph";
import { TOOLS, END } from "@harpua/langgraph";
import { CHAT_MODEL, type ChatModel } from "./chat-model.provider";

export type AgentState = { messages: BaseMessage[] };

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
import { MessagesAnnotation } from "@langchain/langgraph";
import { LangGraph, defineEdges, route, START, TOOLS, END } from "@harpua/langgraph";
import { CallModel, shouldContinue, type AgentState } from "./call-model.node";
import { WeatherTools } from "./weather.tools";

@LangGraph({ name: "weatherAgent", state: MessagesAnnotation, tools: [WeatherTools] })
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

### Checkpointers

Every compiled graph is given a checkpointer (interrupts require one).
Configure it in `LangGraphModule.forRoot`:

```ts
LangGraphModule.forRoot({ checkpointer: { type: "memory" } }); // MemorySaver, the default
```

Escape hatches for a real checkpointer, resolved through the DI container:

```ts
LangGraphModule.forRoot({ checkpointer: { useExisting: PostgresSaverProvider } });
// or
LangGraphModule.forRoot({
  checkpointer: { useFactory: (cfg: ConfigService) => new SomeSaver(cfg.get("dsn")), inject: [ConfigService] },
});
```

Typed, first-class configs for Postgres/SQLite/MongoDB/Redis checkpointers are
on the roadmap; today, plug any `BaseCheckpointSaver` in via `useExisting` or
`useFactory`.

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
| `stream` | `(input, config?) => Promise<AsyncIterable<any>>` | Streams graph output. |
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
