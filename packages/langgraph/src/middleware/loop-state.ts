import { StateSchema } from "@langchain/langgraph";
import { z } from "zod";

export const LoopInfo = z.object({
  iteration: z.number(),
  modelCalls: z.number(),
  toolCalls: z.number(),
  tokens: z.number(),
  /** App-defined spend accumulated by the agent's `costOf` (0 when unused).
   *  The unit is whatever `costOf` returns — dollars, cache-weighted tokens —
   *  and `BudgetOptions.maxCost` is compared in that same unit. Kept separate
   *  from `tokens` so face-value token counts stay honest for gauges. */
  cost: z.number(),
  startedAt: z.number(),
});
export type LoopInfo = z.infer<typeof LoopInfo>;

export const AGENT_LOOP_DEFAULT: LoopInfo = {
  iteration: 0,
  modelCalls: 0,
  toolCalls: 0,
  tokens: 0,
  cost: 0,
  startedAt: 0,
};

export const AgentExit = z.object({
  requested: z.boolean(),
  meta: z.unknown().optional(),
});
export type AgentExit = z.infer<typeof AgentExit>;

export const AGENT_EXIT_DEFAULT: AgentExit = { requested: false };

const loopField = LoopInfo.default(AGENT_LOOP_DEFAULT);

const exitField = AgentExit.default(AGENT_EXIT_DEFAULT);

/**
 * Merge the agent's reserved channels (`loop` + `exit`) into an agent's
 * StateSchema (LastValue).
 *
 * These two channels are persisted (LastValue), so absent any middleware
 * intervention they would accumulate across every invocation on the same
 * checkpointed thread. As of `BudgetMiddleware`'s `reset: "invoke"` default
 * (its `beforeAgent` hook), that accumulation no longer happens in practice:
 * `loop`/`exit` are zeroed back to `AGENT_LOOP_DEFAULT`/`AGENT_EXIT_DEFAULT`
 * at the START of every invoke, so a Budget cap is a per-invoke budget, and a
 * prior exit doesn't stick across re-invokes of the same thread. The
 * per-thread-lifetime behavior described above (counters climbing turn over
 * turn, invoke over invoke, and a stuck `exit.requested`) only applies when
 * Budget is configured with `reset: "thread"` — in that mode, use
 * `clearAgentExit()` (see `./clear-exit`) with `graph.updateState` to
 * explicitly resume a thread that has exited.
 */
export function withAgentLoop(state: unknown): StateSchema<any> {
  if (!(state instanceof StateSchema)) {
    throw new Error(
      "@LangGraphAgent: `state` must be a StateSchema instance in v1 " +
        "(Annotation.Root is not yet supported by withAgentLoop).",
    );
  }
  return new StateSchema({ ...state.fields, loop: loopField, exit: exitField });
}
