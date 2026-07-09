import { interrupt, type LangGraphRunnableConfig } from "@langchain/langgraph";
import type { MiddlewareContext } from "./middleware.types";
import { AGENT_LOOP_DEFAULT } from "./loop-state";

/**
 * Builds the `ctx` a node-hook middleware (`beforeAgent`/`beforeModel`/
 * `afterModel`/`afterAgent`) receives: a read-only view of `state`, the
 * current `loop` bookkeeping, an injected clock (`now()`), a passthrough to
 * LangGraph's `interrupt()`, and `exit()` — the sanctioned way for a hook to
 * short-circuit the agent loop: it sets the reserved `exit` channel to
 * `{ requested: true, meta }`. Actually routing to the loop's canonical exit
 * is an edge-level concern (a conditional edge reads `state.exit.requested`),
 * not the context's job.
 */
export function buildMiddlewareContext<S>(args: {
  state: S;
  config: LangGraphRunnableConfig;
  clock: () => number;
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
