import { AIMessage, HumanMessage } from "@langchain/core/messages";
import { buildCompactionSignal, resolveTrigger } from "../middleware/compaction-signal";
import { AGENT_LOOP_DEFAULT } from "../middleware/loop-state";

function ctxWith(messages: any[]) {
  return {
    state: { messages },
    loop: AGENT_LOOP_DEFAULT,
    config: {},
    now: () => 0,
    interrupt: () => undefined,
    exit: () => ({}),
  } as any;
}

describe("compaction-signal", () => {
  it("reads inputTokens off the last AIMessage usage_metadata", () => {
    const msgs = [new HumanMessage("hi"), new AIMessage({ content: "y", usage_metadata: { input_tokens: 1200, output_tokens: 3, total_tokens: 1203 } })];
    const sig = buildCompactionSignal(ctxWith(msgs));
    expect(sig.inputTokens).toBe(1200);
    expect(sig.messageCount).toBe(2);
  });

  it("token sugar and message sugar desugar to predicates", () => {
    const sig = buildCompactionSignal(ctxWith([new HumanMessage("a"), new HumanMessage("b")]));
    expect(resolveTrigger({ tokens: 100 })({ ...sig, inputTokens: 150 })).toBe(true);
    expect(resolveTrigger({ tokens: 100 })({ ...sig, inputTokens: 50 })).toBe(false);
    expect(resolveTrigger({ messages: 2 })(sig)).toBe(true);
    expect(resolveTrigger((s) => s.messageCount === 2)(sig)).toBe(true);
  });

  it("treats null inputTokens as 0 for the token predicate", () => {
    const sig = buildCompactionSignal(ctxWith([new HumanMessage("a")]));
    expect(sig.inputTokens).toBeNull();
    expect(resolveTrigger({ tokens: 1 })(sig)).toBe(false);
  });
});
