import { AGENT_EXIT_DEFAULT } from "./loop-state";

/**
 * Escape hatch to clear a stuck `exit.requested` on a thread (use with
 * `graph.updateState`). Needed when running Budget with `reset: "thread"` and a
 * lifetime cap has exited the thread but you want to resume it.
 */
export function clearAgentExit(): { exit: typeof AGENT_EXIT_DEFAULT } {
  return { exit: AGENT_EXIT_DEFAULT };
}
