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

  // Some provider/version combos surface token usage ONLY via
  // response_metadata (walkie report 007: OpenRouter streaming persisted
  // tokenUsage but no usage_metadata) — without a fallback the tokens
  // trigger is silently dead while context grows unbounded.
  describe("inputTokens fallback when usage_metadata is absent", () => {
    it("falls back to response_metadata.tokenUsage.prompt_tokens (snake_case), reviving the tokens trigger", () => {
      const msgs = [
        new HumanMessage("hi"),
        new AIMessage({
          content: "y",
          response_metadata: {
            tokenUsage: { prompt_tokens: 131935, completion_tokens: 121, total_tokens: 132056 },
          },
        }),
      ];
      const sig = buildCompactionSignal(ctxWith(msgs));
      expect(sig.inputTokens).toBe(131935);
      expect(resolveTrigger({ tokens: 96_000 })(sig)).toBe(true);
    });

    it("falls back to response_metadata.tokenUsage.promptTokens (camelCase)", () => {
      const msgs = [
        new AIMessage({
          content: "y",
          response_metadata: { tokenUsage: { promptTokens: 500, completionTokens: 7 } },
        }),
      ];
      expect(buildCompactionSignal(ctxWith(msgs)).inputTokens).toBe(500);
    });

    it("falls back to response_metadata.usage.input_tokens", () => {
      const msgs = [
        new AIMessage({
          content: "y",
          response_metadata: { usage: { input_tokens: 800, output_tokens: 9 } },
        }),
      ];
      expect(buildCompactionSignal(ctxWith(msgs)).inputTokens).toBe(800);
    });

    it("prefers usage_metadata over the response_metadata fallbacks", () => {
      const msgs = [
        new AIMessage({
          content: "y",
          usage_metadata: { input_tokens: 100, output_tokens: 1, total_tokens: 101 },
          response_metadata: { tokenUsage: { prompt_tokens: 999_999 } },
        }),
      ];
      expect(buildCompactionSignal(ctxWith(msgs)).inputTokens).toBe(100);
    });

    it("falls back to response_metadata.usage.prompt_tokens", () => {
      const msgs = [
        new AIMessage({
          content: "y",
          response_metadata: { usage: { prompt_tokens: 850 } },
        }),
      ];
      expect(buildCompactionSignal(ctxWith(msgs)).inputTokens).toBe(850);
    });

    it("pins the fallback order: tokenUsage beats usage, snake_case beats camelCase", () => {
      const msgs = [
        new AIMessage({
          content: "y",
          response_metadata: {
            tokenUsage: { prompt_tokens: 111, promptTokens: 222 },
            usage: { input_tokens: 333, prompt_tokens: 444 },
          },
        }),
      ];
      expect(buildCompactionSignal(ctxWith(msgs)).inputTokens).toBe(111);
      const noSnake = [
        new AIMessage({
          content: "y",
          response_metadata: {
            tokenUsage: { promptTokens: 222 },
            usage: { input_tokens: 333 },
          },
        }),
      ];
      expect(buildCompactionSignal(ctxWith(noSnake)).inputTokens).toBe(222);
    });

    it("a junk-typed candidate falls through to a valid sibling instead of killing the read", () => {
      const msgs = [
        new AIMessage({
          content: "y",
          usage_metadata: { input_tokens: -5 } as any, // negative: invalid
          response_metadata: {
            tokenUsage: { prompt_tokens: "x", promptTokens: 777 } as any,
          },
        }),
      ];
      expect(buildCompactionSignal(ctxWith(msgs)).inputTokens).toBe(777);
    });

    it("yields null (never throws) on junk-shaped metadata", () => {
      const msgs = [
        new AIMessage({
          content: "y",
          response_metadata: { tokenUsage: "wat", usage: { input_tokens: "x" } } as any,
        }),
      ];
      const sig = buildCompactionSignal(ctxWith(msgs));
      expect(sig.inputTokens).toBeNull();
      expect(resolveTrigger({ tokens: 1 })(sig)).toBe(false);
    });
  });
});
