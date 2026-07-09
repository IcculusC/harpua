import type { InjectionToken } from "@nestjs/common";
import { StateSchema } from "@langchain/langgraph";
import { z } from "zod";
import { AGENT_METADATA } from "../constants";
import { LangGraph } from "../decorators";
import { withAgentLoop } from "../middleware/loop-state";
import type { MiddlewareEntry } from "../middleware/middleware.decorator";
import type { ToolEntry } from "../interfaces";
import { buildAgentGraph, type AgentBuild } from "./agent-compiler";

/** Options for the {@link LangGraphAgent} preset decorator. */
export interface LangGraphAgentOptions {
  /** Unique agent/graph name; also the facade token and node-id prefix. */
  name: string;
  /** State definition — a `StateSchema` instance (merged with `loop`/`exit`). */
  state: unknown;
  /** DI token resolving the app's base (unbound) chat model. */
  model: InjectionToken;
  /** Tool providers/instances mounted into the loop's `ToolNode`. */
  tools?: ToolEntry[];
  /** Middleware entries partitioned into wrap hooks and node hooks. */
  middleware?: MiddlewareEntry[];
  /** A system prompt (or a DI token resolving one) prepended at model time. */
  systemPrompt?: string | InjectionToken;
  /** When set, a `StructuredResponseNode` coerces the final answer to this schema. */
  responseFormat?: unknown;
  /** Default recursion limit merged into every invoke/stream call. */
  recursionLimit?: number;
}

/** Compiler metadata stored on a `@LangGraphAgent` class under `AGENT_METADATA`. */
export interface AgentMetadata {
  options: LangGraphAgentOptions;
  build: AgentBuild;
}

/**
 * Preset class decorator that lowers an agent loop (model call + tool loop +
 * middleware node/wrap hooks + optional structured response) onto a plain
 * class: it generates the node classes, assembles the canonical edge topology
 * (see {@link buildAgentGraph}), assigns the `edges` array the {@link GraphRegistry}
 * reads, stores {@link AgentMetadata}, and applies the underlying `@LangGraph`
 * with the state merged to carry the reserved `loop`/`exit` channels.
 */
export function LangGraphAgent(options: LangGraphAgentOptions): ClassDecorator {
  return (target) => {
    const build = buildAgentGraph(options);

    // The GraphRegistry reads `edges` off the resolved instance.
    (target as unknown as { prototype: Record<string, unknown> }).prototype.edges =
      build.edges;

    const meta: AgentMetadata = { options, build };
    Reflect.defineMetadata(AGENT_METADATA, meta, target);

    // The StructuredResponseNode writes `outcome`; declare it as a LastValue
    // channel so the parsed result has somewhere to land. Only when
    // `responseFormat` is set — agents without it keep a lean state.
    const looped = withAgentLoop(options.state);
    const state =
      options.responseFormat !== undefined
        ? new StateSchema({ ...looped.fields, outcome: z.unknown().optional() })
        : looped;

    LangGraph({
      name: options.name,
      state,
      tools: options.tools,
      recursionLimit: options.recursionLimit,
    })(target);
  };
}

/** Reads the {@link LangGraphAgentOptions} off a `@LangGraphAgent` class, if any. */
export function getAgentMetadata(
  target: unknown,
): LangGraphAgentOptions | undefined {
  if (typeof target !== "function") return undefined;
  const meta = Reflect.getMetadata(AGENT_METADATA, target) as
    | AgentMetadata
    | undefined;
  return meta?.options;
}
