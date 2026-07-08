import type { Type } from "@nestjs/common";
import type {
  LangGraphRunnableConfig,
  StateSnapshot,
  BaseCheckpointSaver,
} from "@langchain/langgraph";
import type { RunnableConfig } from "@langchain/core/runnables";
import type { BaseMessage } from "@langchain/core/messages";
import type { StructuredToolInterface } from "@langchain/core/tools";
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

/**
 * A single entry in a graph's `tools` array. Either a provider CLASS carrying
 * `@LangGraphTool` methods (DI-resolved and wrapped at bootstrap) or a raw
 * LangChain tool INSTANCE (a `StructuredToolInterface`, e.g. the result of
 * `tool(...)` or `@harpua/agent-tools`' `thinkTool()`), mounted into the same
 * `ToolNode` as-is. The two may be mixed freely.
 */
export type ToolEntry = Type<any> | StructuredToolInterface;

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
  /**
   * Tools mounted into a single `ToolNode` under the `TOOLS` sentinel. Each
   * entry is either a provider class carrying `@LangGraphTool` methods or a raw
   * LangChain tool instance ({@link ToolEntry}); the two may be mixed.
   */
  tools?: ToolEntry[];
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
  /** Gate execution behind a human approval interrupt (see `requiresApproval`). */
  requiresApproval?: boolean;
}

/**
 * Typed config for the official Postgres checkpoint saver
 * (`@langchain/langgraph-checkpoint-postgres`). Either hand the module a
 * connection string (the module owns and closes the resulting pool) or an
 * existing `pg.Pool` you manage yourself (never closed by the module).
 */
export type PostgresCheckpointerOptions =
  | { type: "postgres"; connectionString: string; schema?: string }
  | { type: "postgres"; pool: unknown; schema?: string };

/**
 * Typed config for the official SQLite checkpoint saver
 * (`@langchain/langgraph-checkpoint-sqlite`). `path` may be a file path or the
 * special `:memory:` database. The module owns and closes the connection.
 */
export interface SqliteCheckpointerOptions {
  type: "sqlite";
  /** File path, or `:memory:` for an in-process database. */
  path: string;
}

/**
 * Typed config for the official MongoDB checkpoint saver
 * (`@langchain/langgraph-checkpoint-mongodb`). The saver itself only accepts a
 * connected `MongoClient`; pass one via `client` (never closed by the module),
 * or pass a `url` and the module creates and closes its own client.
 */
export type MongoCheckpointerOptions = {
  type: "mongodb";
  dbName?: string;
  checkpointCollectionName?: string;
  checkpointWritesCollectionName?: string;
  /** Optional TTL (seconds) for checkpoint documents; enables TTL indexes. */
  ttl?: number;
} & ({ client: unknown } | { url: string });

/** TTL behaviour forwarded to the Redis saver. */
export interface RedisTTLConfig {
  defaultTTL?: number;
  refreshOnRead?: boolean;
}

/**
 * Typed config for the official Redis checkpoint saver
 * (`@langchain/langgraph-checkpoint-redis`). Pass a `url` (module creates and
 * closes its own client) or a connected node-redis `client` (never closed by
 * the module).
 */
export type RedisCheckpointerOptions = {
  type: "redis";
  ttl?: RedisTTLConfig;
} & ({ url: string } | { client: unknown });

/** Checkpointer configuration for {@link LangGraphModule.forRoot}. */
export type CheckpointerOptions =
  | { type: "memory" }
  | PostgresCheckpointerOptions
  | SqliteCheckpointerOptions
  | MongoCheckpointerOptions
  | RedisCheckpointerOptions
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
 * Every `streamMode` the compiled graph in `@langchain/langgraph` v1 accepts.
 * (Verified against the installed `StreamMode` union in `pregel/types`.) The
 * facade's typed helpers cover the three everyday ones — `values`, `updates`,
 * `messages`; `streamModes(...)` gives typed access to any combination.
 */
export type StreamMode =
  | "values"
  | "updates"
  | "messages"
  | "custom"
  | "debug"
  | "checkpoints"
  | "tasks"
  | "tools";

/**
 * A single interrupt surfaced while streaming. When a super-step calls
 * `interrupt()`, the stream emits one final chunk carrying these under the
 * `__interrupt__` key (in both `values` and `updates` mode) and then ends.
 * Use {@link getStreamedInterrupts} to detect it and `resume()` to continue.
 */
export interface StreamInterrupt<T = unknown> {
  readonly id?: string;
  readonly value: T;
}

/**
 * A `updates`-mode chunk (also the shape yielded by the default `stream(...)`):
 * a map of node id → the partial state that node returned this super-step. The
 * interrupt terminator arrives as `{ __interrupt__: StreamInterrupt[] }`, which
 * is why the value is widened to also allow the interrupt array.
 */
export type NodeUpdate<TState> = Record<
  string,
  Partial<TState> | readonly StreamInterrupt[]
>;

/**
 * A `messages`-mode chunk: an LLM message (or token) chunk paired with its
 * metadata (node id, tags, …). Token-level streaming requires a real streaming
 * chat model; a node that returns a whole `AIMessage` still emits it as one
 * chunk.
 */
export type MessageChunk = [BaseMessage, Record<string, unknown>];

/**
 * Maps one `streamMode` literal to the `[mode, chunk]` tuple that mode yields
 * when several modes are requested together via {@link LangGraphRunnable.streamModes}.
 */
export type ModeChunk<TState, M extends StreamMode> = M extends "values"
  ? ["values", TState]
  : M extends "updates"
    ? ["updates", NodeUpdate<TState>]
    : M extends "messages"
      ? ["messages", MessageChunk]
      : [M, unknown];

/**
 * Options for {@link LangGraphRunnable.getStateHistory}. Structural mirror of
 * the installed `@langchain/langgraph` `CheckpointListOptions` (which is not
 * re-exported from the package root): cap the number of snapshots, page from a
 * given checkpoint, or filter by checkpoint metadata.
 */
export interface StateHistoryOptions {
  /** Maximum number of snapshots to yield. */
  limit?: number;
  /** Only snapshots created BEFORE this config's checkpoint (pagination). */
  before?: RunnableConfig;
  /** Match against checkpoint metadata (e.g. `{ source: "loop" }`). */
  filter?: Record<string, unknown>;
}

/**
 * Injectable facade over a compiled graph. Mirrors the compiled graph runnable
 * plus a `resume` convenience for human-in-the-loop flows.
 */
export interface LangGraphRunnable<TState = any> {
  invoke(input: any, config?: RunnableConfig): Promise<TState>;
  /**
   * Streams the graph in the default `updates` mode: one {@link NodeUpdate} per
   * super-step. Same `thread_id`/`recursionLimit` defaulting as `invoke`.
   */
  stream(
    input: any,
    config?: RunnableConfig,
  ): Promise<AsyncIterable<NodeUpdate<TState>>>;
  /** Streams full state snapshots (`values` mode) — each chunk is the whole `TState`. */
  streamValues(
    input: any,
    config?: RunnableConfig,
  ): Promise<AsyncIterable<TState>>;
  /** Streams per-node partial updates (`updates` mode); the explicit form of `stream`. */
  streamUpdates(
    input: any,
    config?: RunnableConfig,
  ): Promise<AsyncIterable<NodeUpdate<TState>>>;
  /** Streams LLM message/token chunks (`messages` mode) as `[message, metadata]`. */
  streamMessages(
    input: any,
    config?: RunnableConfig,
  ): Promise<AsyncIterable<MessageChunk>>;
  /**
   * Streams several modes at once, yielding a typed `[mode, chunk]` union so
   * each chunk is discriminated by its leading mode literal.
   */
  streamModes<const M extends StreamMode>(
    input: any,
    modes: readonly M[],
    config?: RunnableConfig,
  ): Promise<AsyncIterable<ModeChunk<TState, M>>>;
  getState(config: RunnableConfig): Promise<StateSnapshot>;
  /**
   * Streams the checkpoint history for a thread, newest snapshot first — the
   * library primitive behind time travel. Same `thread_id` semantics as
   * {@link getState}: the `thread_id` in `config.configurable` selects the
   * thread (no ephemeral default is injected). Each yielded {@link StateSnapshot}
   * carries a `config.configurable.checkpoint_id`; feed that back into `invoke`
   * (`{ configurable: { thread_id, checkpoint_id } }`) to fork/replay from that
   * point. Requires a checkpointer.
   */
  getStateHistory(
    config: RunnableConfig,
    options?: StateHistoryOptions,
  ): AsyncIterableIterator<StateSnapshot>;
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
