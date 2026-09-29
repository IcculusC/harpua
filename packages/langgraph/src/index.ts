import "reflect-metadata";

// Sentinels: START/END re-exported from LangGraph, TOOLS is ours.
export { START, END } from "@langchain/langgraph";
export { TOOLS, getGraphFacadeToken, LANGGRAPH_CHECKPOINTER } from "./constants.js";

// Edge DSL.
export { defineEdges, route, as, isAliasRef, isRouteMarker } from "./edges.js";

// Decorators.
export {
  LangGraph,
  LangGraphTool,
  InjectLangGraphRunnable,
  getGraphMetadata,
  getToolMethods,
  isGraphClass,
} from "./decorators.js";
export type {
  LangGraphToolOptions,
  LangGraphToolBaseOptions,
  LangGraphToolApprovalOptions,
} from "./decorators.js";

// Module + runtime pieces.
export { LangGraphModule } from "./langgraph.module.js";
export { GraphRegistry } from "./graph-registry.js";
export { GraphFacade } from "./graph-facade.js";

// Tool binding: expose a graph's tools to a chat model so it can emit tool
// calls (the ToolNode only executes them).
export {
  buildGraphTools,
  getGraphToolsToken,
  provideGraphTools,
  provideGraphBoundModel,
  requireApproval,
} from "./graph-tools.js";
export type {
  GraphBoundModel,
  ProvideGraphToolsOptions,
  ProvideGraphBoundModelOptions,
  ToolApprovalRequest,
  RequireApprovalOptions,
} from "./graph-tools.js";

// Lazy model binding: defer resolution to first use instead of feature-init.
export { lazyModel, LazyModel, isLazyModel } from "./lazy-model.js";

// ask_user: the model-callable sibling of the approval gate (`requireApproval`)
// — the model calls ask_user with typed questions instead of a gated action;
// the host renders them and the answers return as the tool result.
export { askUserTool } from "./tools/ask-user/ask-user.js";
export { askUserQuestionPresetSchema } from "./tools/ask-user/schemas.js";
export type { AskUserRequest, AskUserQuestionPreset } from "./tools/ask-user/schemas.js";
export type { AskUserToolOptions } from "./tools/ask-user/options.js";

// Streaming helpers.
export { getStreamedInterrupts, INTERRUPT_KEY } from "./stream-utils.js";

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
} from "./interfaces.js";

// Re-export the LangGraph runtime primitives users need in nodes.
export {
  Command,
  interrupt,
  MemorySaver,
  GraphRecursionError,
} from "@langchain/langgraph";
export type { LangGraphRunnableConfig } from "@langchain/langgraph";

// Agent-loop preset: a declarative model<->tools loop that lowers
// transparently to primitives (fully ejectable and addressable).
export { LangGraphAgent, getAgentMetadata } from "./agent/agent.decorator.js";
export type { LangGraphAgentOptions } from "./agent/agent.decorator.js";
export type { SystemPromptSource } from "./agent/system-prompt-middleware.js";
// Both a zod schema (value) and its input type (merged declaration).
export { ResponseFormatOptions } from "./agent/structured-response-node.js";

// Middleware: DI-provider classes implementing node hooks
// (beforeAgent/beforeModel/afterModel/afterAgent) and/or callable-wrap hooks
// (wrapModelCall/wrapToolCall).
//
// NOTE on the `LangGraphMiddleware` name: the decorator (a value, in
// middleware.decorator.ts) and the hook contract (a type, in
// middleware.interface.ts) share the name in source, and the ergonomic goal
// was a single barrel export carrying both — `@LangGraphMiddleware() class X
// implements LangGraphMiddleware {}`. Under this package's `isolatedModules`
// (tsconfig via @harpua/typescript-config/base.json), re-declaring an
// `export type { LangGraphMiddleware }` alongside the `export function
// LangGraphMiddleware` in the same module raises TS2323 ("Cannot redeclare
// exported variable"), and re-exporting that type-only binding from the
// barrel raises TS1448. Falling back per the task brief: the decorator is
// exported as `LangGraphMiddleware`; the hook contract is exported under the
// distinctly-named `LangGraphMiddlewareContract` alias (the same alias name
// already used internally by BudgetMiddleware/RetryMiddleware). Consumers
// write `class X implements LangGraphMiddlewareContract`.
export { LangGraphMiddleware, normalizeMiddleware } from "./middleware/middleware.decorator.js";
export type { MiddlewareEntry, NodeRef } from "./middleware/middleware.decorator.js";
export type { NodeHookName } from "./middleware/middleware.interface.js";
export type { LangGraphMiddleware as LangGraphMiddlewareContract } from "./middleware/middleware.interface.js";
export type {
  MiddlewareContext,
  ModelRequest,
  ToolRequest,
  ModelNext,
  ToolNext,
} from "./middleware/middleware.types.js";
export { lastNonSystemIsHuman } from "./middleware/turn-start.js";

// Reserved persisted loop state the agent loop and its middleware share.
export { withAgentLoop, AGENT_LOOP_DEFAULT, AGENT_EXIT_DEFAULT } from "./middleware/loop-state.js";
export type { LoopInfo, AgentExit } from "./middleware/loop-state.js";

// Reference middlewares. `BudgetOptions`/`RetryOptions` are each both a zod
// schema (value) and its inferred type (merged declaration in the source
// module) — the plain export specifier carries both.
export { BudgetMiddleware, BudgetOptions, BUDGET_OPTS, provideBudget } from "./middleware/budget.middleware.js";
export { RetryMiddleware, RetryOptions, RETRY_OPTS, provideRetry } from "./middleware/retry.middleware.js";
export { ProviderGuardrailMiddleware, ProviderGuardrailOptions, PROVIDER_GUARDRAIL_OPTS, provideProviderGuardrail } from "./middleware/provider-guardrail.middleware.js";

// Context management middleware family: durable compaction (fold) + the
// cache-coherent render layout (view), plus a batteries-included bundle.
export { CompactionMiddleware, provideCompaction } from "./middleware/compaction.middleware.js";
export { ContextWindowMiddleware, provideContextWindow } from "./middleware/context-window.middleware.js";
export { ManagedContextMiddleware, provideManagedContext } from "./middleware/managed-context.middleware.js";
export { clearAgentExit } from "./middleware/clear-exit.js";
export {
  withCompactionState,
  needsCompactionState,
  CompactionSummarySchema,
  COMPACTION_STATE,
} from "./middleware/compaction-state.js";
export { COMPACTION_OPTS, CompactionOptions } from "./middleware/compaction.options.js";
export { CONTEXT_WINDOW_OPTS, ContextWindowOptions } from "./middleware/context-window.options.js";
export { MANAGED_CONTEXT_OPTS, ManagedContextOptions } from "./middleware/managed-context.options.js";
export type { CompactionSummary } from "./middleware/compaction-state.js";
export type { CompactionSignal } from "./middleware/compaction-signal.js";
export type { TriggerSpec, CompactionStrategy } from "./middleware/compaction.options.js";
