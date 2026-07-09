import { CompactionOptions, COMPACTION_OPTS } from "../middleware/compaction.options";
import { CompactionSummarySchema } from "../middleware/compaction-state";

describe("CompactionOptions", () => {
  it("defaults strategy to 'drop'", () => {
    const o = CompactionOptions.parse({ triggerAt: { messages: 40 }, keepRecent: 20 });
    expect(o.strategy).toBe("drop");
  });
  it("accepts a token trigger and a predicate trigger", () => {
    expect(CompactionOptions.parse({ triggerAt: { tokens: 150000 }, keepRecent: 20 }).triggerAt).toEqual({ tokens: 150000 });
    const pred = (s: any) => s.messageCount > 3;
    expect(typeof CompactionOptions.parse({ triggerAt: pred, keepRecent: 20 }).triggerAt).toBe("function");
  });
  it("accepts a summarize strategy with an explicit model token", () => {
    const M = Symbol.for("x");
    const o = CompactionOptions.parse({ triggerAt: { messages: 40 }, keepRecent: 20, strategy: { kind: "summarize", model: M } });
    expect((o.strategy as any).kind).toBe("summarize");
  });
  it("defaults an omitted summarize schema to CompactionSummarySchema", () => {
    const o = CompactionOptions.parse({ triggerAt: { messages: 40 }, keepRecent: 20, strategy: { kind: "summarize", model: Symbol.for("m") } });
    expect((o.strategy as any).schema).toBeDefined();
    expect((o.strategy as any).schema).toBe(CompactionSummarySchema);
  });
  it("rejects an invalid summarize schema", () => {
    expect(() => CompactionOptions.parse({ triggerAt: { messages: 40 }, keepRecent: 20, strategy: { kind: "summarize", model: Symbol.for("m"), schema: "not a schema" } })).toThrow();
  });
  it("rejects keepRecent <= 0", () => {
    expect(() => CompactionOptions.parse({ triggerAt: { messages: 40 }, keepRecent: 0 })).toThrow();
  });
  it("exposes a stable options token", () => {
    expect(COMPACTION_OPTS).toBe(Symbol.for("@harpua/langgraph:COMPACTION_OPTS"));
  });
});
