import {
  Command,
  interrupt,
  type LangGraphRunnableConfig,
} from "@langchain/langgraph";
import type { MiddlewareContext } from "./middleware.types";
import { AGENT_LOOP_DEFAULT } from "./loop-state";

/**
 * Builds the `ctx` a node-hook middleware (`beforeAgent`/`beforeModel`/
 * `afterModel`/`afterAgent`) receives: a read-only view of `state`, the
 * current `loop` bookkeeping, an injected clock (`now()`), a passthrough to
 * LangGraph's `interrupt()`, and `exit()` — the sanctioned way for a hook to
 * short-circuit the agent loop by routing straight to the loop's canonical
 * exit node (the `StructuredResponseNode` id when configured, else `END`).
 */
export function buildMiddlewareContext<S>(args: {
  state: S;
  config: LangGraphRunnableConfig;
  clock: () => number;
  exitTarget: string;
}): MiddlewareContext<S> {
  return {
    state: args.state,
    loop: (args.state as any).loop ?? AGENT_LOOP_DEFAULT,
    config: args.config,
    now: () => args.clock(),
    interrupt: (payload: unknown) => interrupt(payload),
    exit: (meta?: Record<string, unknown>) =>
      new Command({
        goto: args.exitTarget,
        update: meta ? { outcome: meta } : undefined,
      }),
  };
}
