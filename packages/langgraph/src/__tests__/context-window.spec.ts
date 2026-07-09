import { HumanMessage, AIMessage, AIMessage as AI, SystemMessage } from "@langchain/core/messages";
import { ContextWindowMiddleware, provideContextWindow } from "../middleware/context-window.middleware";
import { CONTEXT_WINDOW_OPTS, ContextWindowOptions } from "../middleware/context-window.options";
import { COMPACTION_STATE } from "../middleware/compaction-state";

const SUMMARY = { goal: "g", keyDecisions: [], openQuestions: [], artifacts: [], currentState: "c" };
function req(messages: any[], summary: any) {
  const r: any = { messages, model: { _llmType: () => "openai" }, state: { summary }, withModel(m: any) { return { ...this, model: m }; } };
  return r;
}

describe("ContextWindowMiddleware", () => {
  const opts = ContextWindowOptions.parse({});

  it("carries the compaction-state marker", () => {
    expect((ContextWindowMiddleware as any)[COMPACTION_STATE]).toBe(true);
  });

  it("assembles [head, summary, tail] and forwards to next", async () => {
    const mw = new ContextWindowMiddleware(opts);
    const msgs = [new HumanMessage({ id: "h1", content: "goal" }), new AIMessage({ id: "a1", content: "hi" })];
    let seen: any[] = [];
    const next = async (r: any) => { seen = r.messages; return new AI("done"); };
    await mw.wrapModelCall(req(msgs, SUMMARY), next);
    expect(seen[1]).toBeInstanceOf(SystemMessage); // summary inserted
    expect(seen.length).toBe(3);
  });

  it("provideContextWindow returns [opts provider, class]", () => {
    const providers = provideContextWindow(opts);
    expect(providers[0]).toEqual({ provide: CONTEXT_WINDOW_OPTS, useValue: opts });
    expect(providers[1]).toBe(ContextWindowMiddleware);
  });
});
