import { Injectable, type InjectionToken, type Type } from "@nestjs/common";
import { ModuleRef } from "@nestjs/core";
import { AIMessage, type BaseMessage } from "@langchain/core/messages";
import type { LangGraphRunnableConfig } from "@langchain/langgraph";
import type { NodeHandler } from "../interfaces";
import type { GraphBoundModel } from "../graph-tools";
import { composeModelWrap } from "../middleware/model-wrap";
import { AGENT_LOOP_DEFAULT, type LoopInfo } from "../middleware/loop-state";
import type { ModelRequest } from "../middleware/middleware.types";

/** Config a `@LangGraphAgent` preset uses to generate its `CallModelNode`. */
export interface CallModelNodeConfig {
  /** DI token resolving the graph-bound model (see `provideGraphBoundModel`). */
  modelToken: InjectionToken;
  /** `wrapModelCall` middleware classes, in onion order (first = outermost). */
  wrapMiddleware: Type<any>[];
  /** DI token resolving the clock (`() => number`); defaults to `Date.now`. */
  clockToken?: InjectionToken;
}

/**
 * Builds the model-calling node a `@LangGraphAgent` preset generates: resolves
 * the bound model and `wrapModelCall` middleware via `ModuleRef`, composes the
 * wrap onion around the model invocation, appends the reply to `messages`, and
 * bumps the `loop` bookkeeping (absolute values — the `loop` channel is
 * LastValue, so partial state here fully replaces it). The first model turn
 * also anchors `loop.startedAt` from the clock (never overwriting a non-zero
 * value a `beforeAgent` hook may already have stamped), so Budget's wall-time
 * budget has a start reference even for an agent with no `beforeAgent`
 * middleware — mirroring `makeHookNode`'s injectable-clock handling.
 */
export function makeCallModelNode(
  cfg: CallModelNodeConfig,
): Type<NodeHandler<any>> {
  @Injectable()
  class CallModelNode implements NodeHandler<any> {
    constructor(private readonly moduleRef: ModuleRef) {}

    async run(
      state: any,
      config?: LangGraphRunnableConfig,
    ): Promise<Partial<any>> {
      const model = this.moduleRef.get<GraphBoundModel>(cfg.modelToken, {
        strict: false,
      });
      const clock = cfg.clockToken
        ? this.moduleRef.get<() => number>(cfg.clockToken, { strict: false })
        : () => Date.now();
      const mws = cfg.wrapMiddleware.map((c) =>
        this.moduleRef.get(c, { strict: false }),
      );
      const messages: BaseMessage[] = state.messages ?? [];

      const invoke = async (req: ModelRequest<any>): Promise<AIMessage> => {
        const out = await req.model.invoke(req.messages, config);
        return out instanceof AIMessage
          ? out
          : new AIMessage({
              content: (out as any).content ?? "",
              tool_calls: (out as any).tool_calls,
              usage_metadata: (out as any).usage_metadata,
              id: (out as any).id,
            });
      };

      const chain = composeModelWrap(mws, invoke);
      const req: ModelRequest<any> = {
        messages,
        model,
        state,
        withModel(m) {
          return { ...this, model: m };
        },
      };
      const reply = await chain(req);

      const prev: LoopInfo = state.loop ?? AGENT_LOOP_DEFAULT;
      const loop: LoopInfo = {
        ...prev,
        iteration: prev.iteration + 1,
        modelCalls: prev.modelCalls + 1,
        toolCalls: prev.toolCalls + (reply.tool_calls?.length ?? 0),
        tokens: prev.tokens + (reply.usage_metadata?.total_tokens ?? 0),
        startedAt: prev.startedAt || clock(),
      };

      return { messages: [reply], loop };
    }
  }
  return CallModelNode;
}
