import { StateSchema } from "@langchain/langgraph";
import { z } from "zod";

export const LoopInfo = z.object({
  iteration: z.number(),
  modelCalls: z.number(),
  toolCalls: z.number(),
  tokens: z.number(),
  startedAt: z.number(),
});
export type LoopInfo = z.infer<typeof LoopInfo>;

export const AGENT_LOOP_DEFAULT: LoopInfo = {
  iteration: 0,
  modelCalls: 0,
  toolCalls: 0,
  tokens: 0,
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
 * These two channels are persisted (LastValue) and are NOT reset per
 * `invoke` — they accumulate across every invocation on the same
 * checkpointed thread. Practically this means: a `BudgetMiddleware` cap is a
 * per-thread-lifetime budget, not a per-invoke one (counters keep climbing
 * turn over turn, invoke over invoke), and once an agent has exited
 * (`exit.requested`), that same thread stays exited on a later re-invoke —
 * start a new thread id for a fresh run. A per-invoke reset of these
 * channels is a possible future option, not implemented here.
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
