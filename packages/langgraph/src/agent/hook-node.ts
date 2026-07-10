import { Injectable, type InjectionToken, type Type } from "@nestjs/common";
import { ModuleRef } from "@nestjs/core";
import type { LangGraphRunnableConfig } from "@langchain/langgraph";
import type { NodeHandler } from "../interfaces";
import type { NodeHookName } from "../middleware/middleware.interface";
import { buildMiddlewareContext } from "../middleware/context";
import { AGENT_LOOP_DEFAULT } from "../middleware/loop-state";

/** Config a `@LangGraphAgent` preset uses to generate one middleware's node-hook wrapper. */
export interface HookNodeConfig {
  /** Which node-level hook this generated node invokes, in run order. */
  hook: NodeHookName;
  /** The middleware class providing `hook`, resolved via `ModuleRef`. */
  middlewareClass: Type<any>;
  /** DI token resolving the clock (`() => number`); defaults to `Date.now`. */
  clockToken?: InjectionToken;
}

/**
 * Builds the node a `@LangGraphAgent` preset generates to lower one
 * middleware's node-level hook (`beforeAgent`/`beforeModel`/`afterModel`/
 * `afterAgent`) into the graph: resolves the middleware and clock via
 * `ModuleRef`, builds the hook's {@link MiddlewareContext}, and runs the hook.
 * The hook's `Partial<S>` (or `{}` for void) is returned as the node's state
 * patch — this includes a short-circuit via `ctx.exit()`, which just writes
 * the reserved `exit` channel; an edge-level concern (a conditional edge
 * reading `state.exit.requested`) does the actual routing to the loop's exit.
 * `beforeAgent` additionally (re-)anchors `loop.startedAt` from the clock
 * whenever the merged `loop.startedAt` is zero — both on the first run (nothing
 * stamped yet) AND when a middleware patch explicitly resets `loop` to a
 * zero-`startedAt` value (e.g. Budget's per-invoke reset), so wall-time is
 * measured from THIS invoke, not the thread's first-ever turn. A non-zero
 * `startedAt` (already stamped, no reset patch) is preserved untouched.
 */
export function makeHookNode(cfg: HookNodeConfig): Type<NodeHandler<any>> {
  @Injectable()
  class HookNode implements NodeHandler<any> {
    constructor(private readonly moduleRef: ModuleRef) {}

    async run(
      state: any,
      config?: LangGraphRunnableConfig,
    ): Promise<Partial<any>> {
      const mw = this.moduleRef.get(cfg.middlewareClass, { strict: false });
      const clock = cfg.clockToken
        ? this.moduleRef.get<() => number>(cfg.clockToken, { strict: false })
        : () => Date.now();

      const ctx = buildMiddlewareContext({
        state,
        config: config as LangGraphRunnableConfig,
        clock,
      });

      const result = await mw[cfg.hook](ctx);

      const patch = result ?? {};

      if (cfg.hook === "beforeAgent") {
        const prev = (state as any).loop ?? AGENT_LOOP_DEFAULT;
        const merged = { ...prev, ...(patch as any).loop };
        return {
          ...patch,
          loop: { ...merged, startedAt: merged.startedAt || clock() },
        };
      }

      return patch;
    }
  }
  return HookNode;
}
