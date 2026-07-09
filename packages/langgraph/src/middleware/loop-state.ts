import { StateSchema } from "@langchain/langgraph";
import { z } from "zod";

export interface LoopInfo {
  iteration: number;
  modelCalls: number;
  toolCalls: number;
  tokens: number;
  startedAt: number;
}

export const AGENT_LOOP_DEFAULT: LoopInfo = {
  iteration: 0,
  modelCalls: 0,
  toolCalls: 0,
  tokens: 0,
  startedAt: 0,
};

export interface AgentExit {
  requested: boolean;
  meta?: unknown;
}

export const AGENT_EXIT_DEFAULT: AgentExit = { requested: false };

const loopField = z
  .object({
    iteration: z.number(),
    modelCalls: z.number(),
    toolCalls: z.number(),
    tokens: z.number(),
    startedAt: z.number(),
  })
  .default(AGENT_LOOP_DEFAULT);

const exitField = z
  .object({
    requested: z.boolean(),
    meta: z.unknown().optional(),
  })
  .default(AGENT_EXIT_DEFAULT);

/**
 * Merge the agent's reserved channels (`loop` + `exit`) into an agent's
 * StateSchema (LastValue).
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
