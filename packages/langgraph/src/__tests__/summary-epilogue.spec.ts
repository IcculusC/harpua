import { HumanMessage, AIMessage, ToolMessage } from "@langchain/core/messages";
import { ModuleRef } from "@nestjs/core";
import { CompactionMiddleware, provideCompaction } from "../middleware/compaction.middleware";
import { provideManagedContext } from "../middleware/managed-context.middleware";
import { CompactionOptions, summaryEpilogueOf } from "../middleware/compaction.options";
import { SUMMARY_EPILOGUE } from "../middleware/summary-epilogue.token";
import { renderSummary } from "../middleware/context-assembly";
import { AGENT_LOOP_DEFAULT } from "../middleware/loop-state";

const MODEL = Symbol.for("epilogue-model");
const EPILOGUE = "the transcript was compacted — the NOTEBOOK was not";
const SUMMARY = { goal: "g", keyDecisions: ["d"], openQuestions: [], artifacts: ["f"], currentState: "c" };

class FakeStructuredModel {
  withStructuredOutput(_schema: unknown) {
    return { invoke: async () => SUMMARY };
  }
}
function moduleRefReturning(instance: unknown): ModuleRef {
  return { get: () => instance } as unknown as ModuleRef;
}
function ctx(messages: any[], summary: any = null) {
  return {
    state: { messages, summary },
    loop: AGENT_LOOP_DEFAULT,
    config: {},
    now: () => 0,
    interrupt: () => undefined,
    exit: () => ({}),
  } as any;
}
// Same fixture shape as compaction-summarize.spec.ts — this exact message
// sequence is already proven to trigger a fold under { messages: 6 } /
// keepRecent: 3. Do not simplify it; an all-Human variant changes the fold plan.
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
function tokenValue(providers: any[]): unknown {
  return providers.find((p) => p && p.provide === SUMMARY_EPILOGUE)?.useValue;
}

const optsWithEpilogue = {
  triggerAt: { messages: 6 },
  keepRecent: 3,
  strategy: { kind: "summarize" as const, model: MODEL, epilogue: EPILOGUE },
};

describe("summary epilogue wiring", () => {
  it("accepts epilogue on the summarize strategy", () => {
    const parsed = CompactionOptions.parse(optsWithEpilogue);
    expect((parsed.strategy as any).epilogue).toBe(EPILOGUE);
  });

  it("projects the epilogue out of parsed options, null for drop", () => {
    expect(summaryEpilogueOf(CompactionOptions.parse(optsWithEpilogue))).toBe(EPILOGUE);
    expect(
      summaryEpilogueOf(CompactionOptions.parse({ triggerAt: { messages: 6 }, keepRecent: 3 })),
    ).toBeNull();
    expect(
      summaryEpilogueOf(
        CompactionOptions.parse({
          triggerAt: { messages: 6 },
          keepRecent: 3,
          strategy: { kind: "summarize", model: MODEL },
        }),
      ),
    ).toBeNull();
  });

  it("provideCompaction emits the epilogue token (standalone path)", () => {
    expect(tokenValue(provideCompaction(optsWithEpilogue))).toBe(EPILOGUE);
  });

  it("provideManagedContext emits the epilogue token", () => {
    expect(tokenValue(provideManagedContext(optsWithEpilogue))).toBe(EPILOGUE);
  });

  it("never stores the epilogue in the summary channel across repeated folds", async () => {
    const mw = new CompactionMiddleware(
      CompactionOptions.parse(optsWithEpilogue),
      moduleRefReturning(new FakeStructuredModel()),
    );
    const first: any = await mw.beforeModel(ctx(convo()));
    const second: any = await mw.beforeModel(ctx(convo(), first.summary));
    expect(JSON.stringify(first.summary)).not.toContain(EPILOGUE);
    expect(JSON.stringify(second.summary)).not.toContain(EPILOGUE);
  });

  it("renders the epilogue exactly once, however many folds happened", () => {
    const rendered = String(renderSummary(SUMMARY, EPILOGUE).content);
    expect(rendered.split(EPILOGUE).length - 1).toBe(1);
  });

  it("renders the epilogue even when strategy.schema is custom", () => {
    // the epilogue is schema-independent: it is appended to rendered text,
    // never to a field of the summary object
    const custom = { goal: "x", keyDecisions: [], openQuestions: [], artifacts: [], currentState: "y" };
    expect(String(renderSummary(custom as any, EPILOGUE).content)).toContain(EPILOGUE);
  });
});
