import { HumanMessage, AIMessage, ToolMessage, RemoveMessage } from "@langchain/core/messages";
import { ModuleRef } from "@nestjs/core";
import { Logger } from "@nestjs/common";
import { CompactionMiddleware } from "../middleware/compaction.middleware";
import { CompactionOptions } from "../middleware/compaction.options";
import { AGENT_LOOP_DEFAULT } from "../middleware/loop-state";

const MODEL = Symbol.for("summary-model");
function ctx(messages: any[]) {
  return { state: { messages, summary: null }, loop: AGENT_LOOP_DEFAULT, config: {}, now: () => 0, interrupt: () => undefined, exit: () => ({}) } as any;
}
function convo() {
  return [
    new HumanMessage({ id: "h1", content: "goal" }),
    new AIMessage({ id: "a1", content: "", tool_calls: [{ name: "t", args: {}, id: "c1", type: "tool_call" }] }),
    new ToolMessage({ id: "t1", content: "r", tool_call_id: "c1" }),
    new HumanMessage({ id: "h2", content: "n" }),
    new AIMessage({ id: "a2", content: "ok" }),
    new HumanMessage({ id: "h3", content: "m" }),
    new AIMessage({ id: "a3", content: "s" }),
  ];
}
const SUMMARY = { goal: "g", keyDecisions: ["d"], openQuestions: [], artifacts: ["f"], currentState: "c" };

/**
 * Minimal local fake standing in for a `withStructuredOutput`-capable
 * `BaseChatModel`. `summarizeSpan` only ever calls
 * `model.withStructuredOutput(schema).invoke(messages)`, so this suffices —
 * see the header comments in `agent-boot.spec.ts` / `agent-eject-parity.spec.ts`
 * for why this package's tests use local fakes instead of
 * `@harpua/langgraph-testing` (which peer-depends on this package; pulling it
 * in here would be a circular workspace/build-graph dependency).
 */
class FakeStructuredModel {
  withStructuredOutput(_schema: unknown) {
    return { invoke: async () => SUMMARY };
  }
}

function moduleRefReturning(instance: unknown): ModuleRef {
  return { get: () => instance } as unknown as ModuleRef;
}

describe("CompactionMiddleware (summarize)", () => {
  const opts = CompactionOptions.parse({ triggerAt: { messages: 6 }, keepRecent: 3, strategy: { kind: "summarize", model: MODEL } });

  it("writes a structured summary to the summary channel + emits removals", async () => {
    const mw = new CompactionMiddleware(opts, moduleRefReturning(new FakeStructuredModel()));
    const patch: any = await mw.beforeModel(ctx(convo()));
    expect(patch.summary).toEqual(SUMMARY);
    expect(patch.messages.every((m: any) => m instanceof RemoveMessage)).toBe(true);
  });

  it("falls back to drop (no summary) when the summarizer throws", async () => {
    const throwing = { withStructuredOutput: () => ({ invoke: async () => { throw new Error("boom"); } }) };
    const mw = new CompactionMiddleware(opts, moduleRefReturning(throwing));
    const patch: any = await mw.beforeModel(ctx(convo()));
    expect(patch.summary).toBeUndefined();
    expect(patch.messages.every((m: any) => m instanceof RemoveMessage)).toBe(true);
  });

  it("logs a warning (with the error message) when the summarizer throws, and still falls back to drop", async () => {
    const warnSpy = jest.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);
    try {
      const throwing = { withStructuredOutput: () => ({ invoke: async () => { throw new Error("unresolvable model token"); } }) };
      const mw = new CompactionMiddleware(opts, moduleRefReturning(throwing));
      const patch: any = await mw.beforeModel(ctx(convo()));

      expect(warnSpy).toHaveBeenCalledTimes(1);
      expect(warnSpy.mock.calls[0]?.[0]).toEqual(
        expect.stringContaining("compaction: summarize failed, falling back to drop: unresolvable model token"),
      );
      expect(patch.summary).toBeUndefined();
      expect(patch.messages.every((m: any) => m instanceof RemoveMessage)).toBe(true);
    } finally {
      warnSpy.mockRestore();
    }
  });
});
