import { interrupt, type LangGraphRunnableConfig } from "@langchain/langgraph";
import type { MiddlewareContext } from "./middleware.types";
import { AGENT_LOOP_DEFAULT } from "./loop-state";

/**
 * Builds the `ctx` a node-hook middleware (`beforeAgent`/`beforeModel`/
 * `afterModel`/`afterAgent`) receives: a read-only view of `state`, the
 * current `loop` bookkeeping, an injected clock (`now()`), a passthrough to
 * LangGraph's `interrupt()`, and `exit()` — the sanctioned way for a hook to
 * short-circuit the agent loop: it writes the reserved `exit` channel, which
 * the loop's conditional edges route on to the canonical exit node (the
 * `StructuredResponseNode` id when configured, else `END`).
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
      ({ exit: { requested: true, meta } }) as unknown as Partial<S>,
  };
}
