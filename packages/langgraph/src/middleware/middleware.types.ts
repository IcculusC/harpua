import type { LangGraphRunnableConfig } from "@langchain/langgraph";
import type { AIMessage, BaseMessage, ToolMessage } from "@langchain/core/messages";
import type { GraphBoundModel } from "../graph-tools";
import type { LoopInfo } from "./loop-state";

/**
 * The read/write surface a node-level middleware hook (`beforeAgent`,
 * `beforeModel`, `afterModel`, `afterAgent`) receives. `state` is read-only —
 * hooks return a `Partial<S>` to apply updates rather than mutating in place.
 */
export interface MiddlewareContext<S> {
  state: Readonly<S>;
  loop: LoopInfo;
  config: LangGraphRunnableConfig;
  now(): number;
  interrupt(payload: unknown): unknown;
  exit(meta?: Record<string, unknown>): Partial<S>;
}

/**
 * The mutable request a `wrapModelCall` middleware receives before invoking
 * the model. `messages` and `model` are plain mutable properties so a
 * middleware can rewrite them directly; `withModel` is a convenience helper
 * for swapping the model without touching the rest of the request.
 */
export interface ModelRequest<S> {
  messages: BaseMessage[];
  model: GraphBoundModel;
  state: Readonly<S>;
  withModel(model: GraphBoundModel): ModelRequest<S>;
}

/** The request a `wrapToolCall` middleware receives before invoking a tool. */
export interface ToolRequest<S> {
  name: string;
  args: unknown;
  id: string;
  state: Readonly<S>;
}

export type ModelNext = (req: ModelRequest<any>) => Promise<AIMessage>;
export type ToolNext = (call: ToolRequest<any>) => Promise<ToolMessage>;
