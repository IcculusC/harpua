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
  /**
   * Per-reply spend, accumulated into `loop.cost` (the input to
   * `BudgetOptions.maxCost`). Receives the NORMALIZED reply — reconstruction
   * has already run, so `response_metadata` is readable on every reply shape
   * (chunks, foreign copies). Unit is the app's own (dollars recommended);
   * unset = `loop.cost` stays 0 and no cost is tracked.
   */
  costOf?: (reply: AIMessage) => number;
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
        // Reconstruction must be lossless for every field a consumer reads
        // off the CHECKPOINTED message: response_metadata carries the
        // compaction signal's fallback token counts (a provider may omit
        // usage_metadata), additional_kwargs carries provider extras.
        return out instanceof AIMessage
          ? out
          : new AIMessage({
              content: (out as any).content ?? "",
              tool_calls: (out as any).tool_calls,
              invalid_tool_calls: (out as any).invalid_tool_calls,
              usage_metadata: (out as any).usage_metadata,
              response_metadata: (out as any).response_metadata,
              additional_kwargs: (out as any).additional_kwargs,
              name: (out as any).name,
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

      // costOf reads the LIVE normalized reply on purpose: usage fields do
      // not reliably survive a checkpoint round-trip (observed: OpenRouter
      // usage_metadata lost in serialization, response_metadata kept), so
      // the accumulator here is the only durable record of spend — a design
      // that recomputes cost from checkpointed messages undercounts, and
      // compaction folding messages away makes recomputation doubly wrong.
      let costDelta = 0;
      if (cfg.costOf !== undefined) {
        costDelta = cfg.costOf(reply);
        if (!Number.isFinite(costDelta)) {
          // NaN would poison the accumulator silently (NaN >= maxCost is
          // false forever), permanently disarming the cap the app set.
          throw new Error(
            `costOf returned a non-finite number (${String(costDelta)}) — ` +
              `the cost budget would be silently disarmed. Fix the cost ` +
              `model to return a finite number for every reply.`,
          );
        }
      }

      const prev: LoopInfo = state.loop ?? AGENT_LOOP_DEFAULT;
      const loop: LoopInfo = {
        ...prev,
        iteration: prev.iteration + 1,
        modelCalls: prev.modelCalls + 1,
        toolCalls: prev.toolCalls + (reply.tool_calls?.length ?? 0),
        tokens: prev.tokens + (reply.usage_metadata?.total_tokens ?? 0),
        // `?? 0`: a loop checkpointed before `cost` existed resumes without
        // the field — `undefined + delta` is NaN and NaN never un-poisons.
        cost: (prev.cost ?? 0) + costDelta,
        startedAt: prev.startedAt || clock(),
      };

      return { messages: [reply], loop };
    }
  }
  return CallModelNode;
}
