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
export type {
  LangGraphToolOptions,
  LangGraphToolBaseOptions,
  LangGraphToolApprovalOptions,
} from "./decorators";

// Module + runtime pieces.
export { LangGraphModule } from "./langgraph.module";
export { GraphRegistry } from "./graph-registry";
export { GraphFacade } from "./graph-facade";

// Tool binding: expose a graph's tools to a chat model so it can emit tool
// calls (the ToolNode only executes them).
export {
  buildGraphTools,
  getGraphToolsToken,
  provideGraphTools,
  provideGraphBoundModel,
  requireApproval,
} from "./graph-tools";
export type {
  GraphBoundModel,
  ProvideGraphToolsOptions,
  ProvideGraphBoundModelOptions,
  ToolApprovalRequest,
  RequireApprovalOptions,
} from "./graph-tools";

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
  ToolEntry,
  ToolMethodMetadata,
  ApprovalMessageFn,
  DeclineMessageFn,
  CheckpointerOptions,
  PostgresCheckpointerOptions,
  SqliteCheckpointerOptions,
  MongoCheckpointerOptions,
  RedisCheckpointerOptions,
  RedisTTLConfig,
  LangGraphModuleOptions,
  LangGraphModuleAsyncOptions,
  LangGraphRunnable,
  StateHistoryOptions,
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
