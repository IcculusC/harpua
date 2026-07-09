import { StateSchema } from "@langchain/langgraph";
import { z } from "zod";

/** Default structured summary the `summarize` strategy produces. */
export const CompactionSummarySchema = z.object({
  goal: z.string(),
  keyDecisions: z.array(z.string()),
  openQuestions: z.array(z.string()),
  artifacts: z.array(z.string()),
  currentState: z.string(),
});
export type CompactionSummary = z.infer<typeof CompactionSummarySchema>;

/** Static marker: a middleware class that requires the `summary` state channel. */
export const COMPACTION_STATE = Symbol.for("@harpua/langgraph:COMPACTION_STATE");

const summaryField = z
  .custom<CompactionSummary | null>()
  .nullable()
  .default(null);

/** Merge the persisted `summary` channel (LastValue) into an agent's StateSchema. */
export function withCompactionState(state: StateSchema<any>): StateSchema<any> {
  return new StateSchema({ ...state.fields, summary: summaryField });
}

/** A middleware class reference (its constructor, not an instance). */
type MiddlewareClass = abstract new (...args: never[]) => unknown;

/** True when any middleware class carries the {@link COMPACTION_STATE} marker. */
export function needsCompactionState(mwClasses: MiddlewareClass[]): boolean {
  return mwClasses.some(
    (c) => (c as unknown as Record<symbol, unknown>)[COMPACTION_STATE] === true,
  );
}
