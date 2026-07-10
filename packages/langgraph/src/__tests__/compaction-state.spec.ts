import { StateSchema, MessagesValue } from "@langchain/langgraph";
import {
  CompactionSummarySchema,
  withCompactionState,
  needsCompactionState,
  COMPACTION_STATE,
} from "../middleware/compaction-state";

describe("compaction-state", () => {
  it("parses a well-formed summary", () => {
    const s = CompactionSummarySchema.parse({
      goal: "g", keyDecisions: [], openQuestions: [], artifacts: [], currentState: "c",
    });
    expect(s.goal).toBe("g");
  });

  it("adds a `summary` channel defaulting to null", () => {
    const base = new StateSchema({ messages: MessagesValue });
    const merged = withCompactionState(base);
    expect(Object.keys(merged.fields)).toContain("summary");
    expect(Object.keys(merged.fields)).toContain("messages");
  });

  it("detects classes that carry the compaction-state marker", () => {
    class Marked { static [COMPACTION_STATE] = true; }
    class Plain {}
    expect(needsCompactionState([Marked, Plain])).toBe(true);
    expect(needsCompactionState([Plain])).toBe(false);
  });
});
