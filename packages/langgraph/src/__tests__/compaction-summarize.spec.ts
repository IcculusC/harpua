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
function megaTurn(pairs: number) {
  const msgs: any[] = [
    new HumanMessage({ id: "h1", content: "goal" }),
    new HumanMessage({ id: "h2", content: "the one big ask" }),
  ];
  for (let i = 0; i < pairs; i++) {
    msgs.push(new AIMessage({ id: `la${i}`, content: "", tool_calls: [{ name: "t", args: {}, id: `c${i}`, type: "tool_call" }] }));
    msgs.push(new ToolMessage({ id: `lt${i}`, content: "r", tool_call_id: `c${i}` }));
  }
  return msgs;
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

  it("folds a mega-turn (no human boundary in the foldable region) at an AI boundary", async () => {
    // One turn outgrew the trigger on its own: humans only at the pinned head
    // and the running turn's own message, then a long tool loop. Summarize
    // folds may sever the running turn — the summary carries the ask.
    // megaTurn(5) => n=12, keepRecent=3 => naive cut at 9 (lt3) => parent AI
    // la3 @8: folds h2 + pairs 0..2 exactly; the keepRecent tail survives.
    const mw = new CompactionMiddleware(opts, moduleRefReturning(new FakeStructuredModel()));
    const patch: any = await mw.beforeModel(ctx(megaTurn(5)));
    expect(patch.summary).toEqual(SUMMARY);
    expect(patch.messages.every((m: any) => m instanceof RemoveMessage)).toBe(true);
    expect(patch.messages.map((m: any) => m.id)).toEqual(["h2", "la0", "lt0", "la1", "lt1", "la2", "lt2"]);
  });

  it("declines mega-turn folds (warn once) when no ContextWindowMiddleware renders the summary", async () => {
    // The AI-boundary cut folds the running turn's own ask; the summary that
    // stands in for it is only ever rendered by ContextWindowMiddleware's
    // view. Standalone provideCompaction + summarize writes the summary to a
    // channel nothing reads — folding there would erase the live instruction
    // invisibly, so the fallback requires a resolvable renderer.
    const warnSpy = jest.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);
    try {
      const modelOnly = {
        get: (token: unknown) => {
          if (token === MODEL) return new FakeStructuredModel();
          throw new Error("nothing else registered");
        },
      } as unknown as ModuleRef;
      const mw = new CompactionMiddleware(opts, modelOnly);
      expect(await mw.beforeModel(ctx(megaTurn(5)))).toBeUndefined();
      expect(await mw.beforeModel(ctx(megaTurn(5)))).toBeUndefined();
      expect(warnSpy).toHaveBeenCalledTimes(1);
      expect(warnSpy.mock.calls[0]?.[0]).toEqual(expect.stringContaining("ContextWindowMiddleware"));
    } finally {
      warnSpy.mockRestore();
    }
  });

  it("stops attempting mega-turn summaries for a thread after 3 consecutive failures", async () => {
    // A persistent post-tokens summarizer failure (schema mismatch, provider
    // rejecting the span) would otherwise cost a peak-context summarize
    // attempt EVERY cycle for the rest of the turn — the decline path retries
    // by design, so it needs a per-thread cap.
    const warnSpy = jest.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);
    try {
      let attempts = 0;
      const throwing = {
        get: () => ({
          withStructuredOutput: () => ({
            invoke: async () => { attempts++; throw new Error("schema mismatch"); },
          }),
        }),
      } as unknown as ModuleRef;
      const mw = new CompactionMiddleware(opts, throwing);
      const threadCtx = () => ({ ...ctx(megaTurn(5)), config: { configurable: { thread_id: "t-cap" } } });
      for (let i = 0; i < 5; i++) {
        expect(await mw.beforeModel(threadCtx())).toBeUndefined();
      }
      expect(attempts).toBe(3);
      expect(warnSpy.mock.calls.map((c) => String(c[0])).join("\n")).toEqual(
        expect.stringContaining("giving up"),
      );
    } finally {
      warnSpy.mockRestore();
    }
  });

  it("declines a mega-turn fold entirely when the summarizer throws — never a bare drop of the running turn", async () => {
    const warnSpy = jest.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);
    try {
      const throwing = { withStructuredOutput: () => ({ invoke: async () => { throw new Error("boom"); } }) };
      const mw = new CompactionMiddleware(opts, moduleRefReturning(throwing));
      const patch: any = await mw.beforeModel(ctx(megaTurn(5)));
      // The human-boundary drop fallback preserves the running turn; an
      // AI-boundary drop would erase the model's current ask with no record.
      // Decline and retry next cycle instead.
      expect(patch).toBeUndefined();
      expect(warnSpy.mock.calls[0]?.[0]).toEqual(expect.stringContaining("declining"));
    } finally {
      warnSpy.mockRestore();
    }
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
