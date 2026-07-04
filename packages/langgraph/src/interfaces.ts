import type { Type } from "@nestjs/common";
import type {
  LangGraphRunnableConfig,
  StateSnapshot,
  BaseCheckpointSaver,
} from "@langchain/langgraph";
import type { RunnableConfig } from "@langchain/core/runnables";
import type { TOOLS } from "./constants";

/**
 * A LangGraph node implemented as an ordinary `@Injectable` Nest provider.
 *
 * A node declares only the STATE SLICE it touches via `TState`, which makes the
 * same class reusable across graphs whose composite state is a structural
 * superset of that slice.
 */
export interface NodeHandler<TState> {
  run(
    state: TState,
    config?: LangGraphRunnableConfig,
  ): Partial<TState> | Promise<Partial<TState>>;
}

/**
 * Structural, strictly-variant view of {@link NodeHandler} used only for
 * edge-slot typing. `run` is modelled as a function PROPERTY (not a method) so
 * TypeScript applies strict contravariant parameter checking. That is what makes
 * `defineEdges<TGraph>` reject a node whose state slice `S` is not satisfied by
 * `TGraph` (i.e. requires `TGraph extends S`).
 */
export interface StrictNodeHandler<TState> {
  run: (
    state: TState,
    config?: LangGraphRunnableConfig,
  ) => Partial<TState> | Promise<Partial<TState>>;
}

/** A node class whose declared slice is satisfied by `TGraphState`. */
export type NodeClassRef<TGraphState> = Type<StrictNodeHandler<TGraphState>>;

/** Alias wrapper produced by {@link as}, letting one node class appear twice. */
export interface AliasRef<TGraphState = unknown> {
  readonly __kind: "alias";
  readonly alias: string;
  readonly node: NodeClassRef<TGraphState>;
}

/**
 * A `@LangGraph`-decorated graph definition class used as an edge target. Graph
 * classes expose an `edges` member; node classes expose `run`. That structural
 * difference keeps subgraph refs distinct from node refs at the type level.
 */
export type SubgraphRef = Type<{ edges: readonly unknown[] }>;

/** Result a {@link route} function may return. */
export type RouteResult<TGraphState> =
  | EdgeTarget<TGraphState>
  | ReadonlyArray<EdgeTarget<TGraphState>>;

/** Conditional edge produced by {@link route}. */
export interface RouteMarker<TGraphState = unknown> {
  readonly __kind: "route";
  readonly fn: (
    state: TGraphState,
    config?: LangGraphRunnableConfig,
  ) => RouteResult<TGraphState> | Promise<RouteResult<TGraphState>>;
  readonly pathMap?: ReadonlyArray<EdgeTarget<TGraphState>>;
}

/** Anything that may appear on the `from` side of an edge. */
export type EdgeSource<TGraphState> =
  | typeof import("@langchain/langgraph").START
  | TOOLS
  | NodeClassRef<TGraphState>
  | AliasRef<TGraphState>
  | SubgraphRef;

/** Anything that may appear on the `to` side of an edge (excluding routes). */
export type EdgeTarget<TGraphState> =
  | typeof import("@langchain/langgraph").END
  | TOOLS
  | NodeClassRef<TGraphState>
  | AliasRef<TGraphState>
  | SubgraphRef;

/** A single edge in a graph definition. */
export interface GraphEdge<TGraphState> {
  from: EdgeSource<TGraphState>;
  to: EdgeTarget<TGraphState> | RouteMarker<TGraphState>;
}

/** A loose node reference used where slice typing is not enforced. */
export type AnyNodeRef =
  | Type<any>
  | AliasRef<any>
  | TOOLS;

/**
 * Extracts the state TS type from anything exposing a `.State` property —
 * both a zod-based `StateSchema` instance and an `Annotation.Root` do. Lets
 * `defineEdges<StateOf<typeof MyState>>(...)` derive the graph state type
 * straight from the schema instead of hand-declaring a parallel type alias.
 *
 * @example
 * ```ts
 * const AgentState = new StateSchema({ messages: MessagesValue });
 * type AgentStateT = StateOf<typeof AgentState>;
 * ```
 */
export type StateOf<T extends { State: unknown }> = T["State"];

/** Options accepted by the {@link LangGraph} class decorator. */
export interface LangGraphOptions {
  /** Unique graph name; also the facade token and default node id for subgraphs. */
  name: string;
  /**
   * State definition. Accepts what the installed `@langchain/langgraph` major
   * supports on `new StateGraph(state)` — a zod object schema (preferred), an
   * `Annotation.Root`, or a `StateSchema` instance.
   */
  state: unknown;
  /** Provider classes carrying `@LangGraphTool` methods, wrapped into a ToolNode. */
  tools?: Type<any>[];
  /** Default recursion limit merged into every invoke/stream call. */
  recursionLimit?: number;
  /** Static interrupt-before targets (resolved to node ids at compile). */
  interruptBefore?: AnyNodeRef[];
  /** Static interrupt-after targets (resolved to node ids at compile). */
  interruptAfter?: AnyNodeRef[];
}

/** Descriptor stored per `@LangGraphTool` method. */
export interface ToolMethodMetadata {
  methodName: string | symbol;
  name?: string;
  description: string;
  schema: unknown;
}

/** Checkpointer configuration for {@link LangGraphModule.forRoot}. */
export type CheckpointerOptions =
  | { type: "memory" }
  | { useExisting: Type<BaseCheckpointSaver> }
  | {
      useFactory: (
        ...args: any[]
      ) => BaseCheckpointSaver | Promise<BaseCheckpointSaver>;
      inject?: any[];
    };

export interface LangGraphModuleOptions {
  checkpointer?: CheckpointerOptions;
}

export interface LangGraphModuleAsyncOptions {
  imports?: any[];
  useFactory: (
    ...args: any[]
  ) => LangGraphModuleOptions | Promise<LangGraphModuleOptions>;
  inject?: any[];
}

/**
 * Injectable facade over a compiled graph. Mirrors the compiled graph runnable
 * plus a `resume` convenience for human-in-the-loop flows.
 */
export interface LangGraphRunnable<TState = any> {
  invoke(input: any, config?: RunnableConfig): Promise<TState>;
  stream(input: any, config?: RunnableConfig): Promise<AsyncIterable<any>>;
  getState(config: RunnableConfig): Promise<StateSnapshot>;
  updateState(
    config: RunnableConfig,
    values: Record<string, unknown> | unknown,
    asNode?: string,
  ): Promise<RunnableConfig>;
  /** Resume an interrupted run: sugar for `invoke(new Command({ resume }), ...)`. */
  resume(
    threadId: string,
    resumeValue: unknown,
    config?: RunnableConfig,
  ): Promise<TState>;
}
