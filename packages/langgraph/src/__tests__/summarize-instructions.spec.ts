import { HumanMessage } from "@langchain/core/messages";
import { summarizeSpan } from "../middleware/summarize";
import { CompactionOptions } from "../middleware/compaction.options";

const SUMMARY = { goal: "g", keyDecisions: ["d"], openQuestions: [], artifacts: ["f"], currentState: "c" };

/** Captures the messages handed to the summarizer so the system text can be asserted. */
class CapturingModel {
  captured: any[] = [];
  withStructuredOutput(_schema: unknown) {
    return {
      invoke: async (msgs: any[]) => {
        this.captured = msgs;
        return SUMMARY;
      },
    };
  }
}

const BASE =
  "Summarize the earlier conversation into the requested structured object. " +
  "Preserve the enduring goal, key decisions, open questions, and artifacts. " +
  "If a prior summary is provided, fold it into the new one so nothing is lost.";

describe("summarizeSpan instructions", () => {
  it("sends the base system text unchanged when no instructions are given", async () => {
    const model = new CapturingModel();
    await summarizeSpan(model as any, undefined, null, [new HumanMessage({ id: "h1", content: "x" })]);
    expect(String(model.captured[0].content)).toBe(BASE);
  });

  it("appends instructions after the base text in a single system message", async () => {
    const model = new CapturingModel();
    await summarizeSpan(
      model as any,
      undefined,
      null,
      [new HumanMessage({ id: "h1", content: "x" })],
      "PRESERVE NUMBERS: part numbers, pin assignments.",
    );
    expect(String(model.captured[0].content)).toBe(
      `${BASE}\nPRESERVE NUMBERS: part numbers, pin assignments.`,
    );
    // still ONE system message — a second would move the cache prefix
    expect(model.captured.filter((m: any) => m._getType() === "system")).toHaveLength(1);
  });

  it("accepts instructions on the summarize strategy", () => {
    const parsed = CompactionOptions.parse({
      triggerAt: { messages: 6 },
      keepRecent: 3,
      strategy: { kind: "summarize", model: Symbol.for("m"), instructions: "keep numbers" },
    });
    expect((parsed.strategy as any).instructions).toBe("keep numbers");
  });

  it("rejects an empty instructions string", () => {
    expect(() =>
      CompactionOptions.parse({
        triggerAt: { messages: 6 },
        keepRecent: 3,
        strategy: { kind: "summarize", model: Symbol.for("m"), instructions: "" },
      }),
    ).toThrow();
  });
});
