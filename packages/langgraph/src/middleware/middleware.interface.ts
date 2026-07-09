import type { Command } from "@langchain/langgraph";
import type { AIMessage, ToolMessage } from "@langchain/core/messages";
import type {
  MiddlewareContext,
  ModelNext,
  ModelRequest,
  ToolNext,
  ToolRequest,
} from "./middleware.types";

export type {
  MiddlewareContext,
  ModelNext,
  ModelRequest,
  ToolNext,
  ToolRequest,
} from "./middleware.types";

/** The four node-level hooks a middleware may implement, in run order. */
export type NodeHookName = "beforeAgent" | "beforeModel" | "afterModel" | "afterAgent";

/**
 * The middleware contract for the agent loop. Node hooks observe/patch state
 * around the agent's lifecycle; the `wrap*Call` hooks intercept the model and
 * tool invocations themselves (each responsible for calling `next`).
 */
export interface LangGraphMiddleware<S = any> {
  beforeAgent?(
    ctx: MiddlewareContext<S>,
  ): Promise<Partial<S> | void> | Partial<S> | void;
  beforeModel?(
    ctx: MiddlewareContext<S>,
  ): Promise<Partial<S> | Command | void> | Partial<S> | Command | void;
  afterModel?(
    ctx: MiddlewareContext<S>,
  ): Promise<Partial<S> | void> | Partial<S> | void;
  afterAgent?(
    ctx: MiddlewareContext<S>,
  ): Promise<Partial<S> | void> | Partial<S> | void;
  wrapModelCall?(req: ModelRequest<S>, next: ModelNext): Promise<AIMessage>;
  wrapToolCall?(call: ToolRequest<S>, next: ToolNext): Promise<ToolMessage>;
}
