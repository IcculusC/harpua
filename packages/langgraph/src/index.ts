import "reflect-metadata";

// Sentinels: START/END re-exported from LangGraph, TOOLS is ours.
export { START, END } from "@langchain/langgraph";
export { TOOLS, getGraphFacadeToken, LANGGRAPH_CHECKPOINTER } from "./constants";

// Edge DSL.
export { defineEdges, route, as, isAliasRef, isRouteMarker } from "./edges";

// Decorators.
export {
  LangGraph,
  LangGraphTool,
  InjectLangGraphRunnable,
  getGraphMetadata,
  getToolMethods,
  isGraphClass,
} from "./decorators";
export type { LangGraphToolOptions } from "./decorators";

// Module + runtime pieces.
export { LangGraphModule } from "./langgraph.module";
export { GraphRegistry } from "./graph-registry";
export { GraphFacade } from "./graph-facade";

// Streaming helpers.
export { getStreamedInterrupts, INTERRUPT_KEY } from "./stream-utils";

// Public types.
export type {
  NodeHandler,
  StrictNodeHandler,
  NodeClassRef,
  AliasRef,
  SubgraphRef,
  RouteMarker,
  RouteResult,
  EdgeSource,
  EdgeTarget,
  GraphEdge,
  AnyNodeRef,
  LangGraphOptions,
  ToolMethodMetadata,
  CheckpointerOptions,
  PostgresCheckpointerOptions,
  SqliteCheckpointerOptions,
  MongoCheckpointerOptions,
  RedisCheckpointerOptions,
  RedisTTLConfig,
  LangGraphModuleOptions,
  LangGraphModuleAsyncOptions,
  LangGraphRunnable,
  StreamMode,
  StreamInterrupt,
  NodeUpdate,
  MessageChunk,
  ModeChunk,
  StateOf,
} from "./interfaces";

// Re-export the LangGraph runtime primitives users need in nodes.
export {
  Command,
  interrupt,
  MemorySaver,
  GraphRecursionError,
} from "@langchain/langgraph";
export type { LangGraphRunnableConfig } from "@langchain/langgraph";
