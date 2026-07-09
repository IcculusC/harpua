import { Injectable, type InjectionToken, type Type } from "@nestjs/common";
import { ModuleRef } from "@nestjs/core";
import { Command, type LangGraphRunnableConfig } from "@langchain/langgraph";
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
  /** Node id the hook's `ctx.exit()` routes to (the loop's canonical exit). */
  exitTarget: string;
  /** DI token resolving the clock (`() => number`); defaults to `Date.now`. */
  clockToken?: InjectionToken;
}

/**
 * Builds the node a `@LangGraphAgent` preset generates to lower one
 * middleware's node-level hook (`beforeAgent`/`beforeModel`/`afterModel`/
 * `afterAgent`) into the graph: resolves the middleware and clock via
 * `ModuleRef`, builds the hook's {@link MiddlewareContext}, and runs the hook.
 * A `Command` result (routing/short-circuit, e.g. `ctx.exit()`) is returned
 * as-is — loop state must NOT be merged into it. Otherwise the hook's
 * `Partial<S>` (or `{}` for void) is returned, with `beforeAgent` additionally
 * stamping `loop.startedAt` from the clock the first time it runs (never
 * overwriting a non-zero value already there).
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
        exitTarget: cfg.exitTarget,
      });

      const result = await mw[cfg.hook](ctx);

      if (result instanceof Command) {
        return result;
      }

      const patch = result ?? {};

      if (cfg.hook === "beforeAgent") {
        const prev = (state as any).loop ?? AGENT_LOOP_DEFAULT;
        return {
          ...patch,
          loop: {
            ...prev,
            ...(patch as any).loop,
            startedAt: prev.startedAt || clock(),
          },
        };
      }

      return patch;
    }
  }
  return HookNode;
}
