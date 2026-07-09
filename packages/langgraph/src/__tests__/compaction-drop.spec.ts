import { HumanMessage, AIMessage, ToolMessage, RemoveMessage } from "@langchain/core/messages";
import { CompactionMiddleware, provideCompaction } from "../middleware/compaction.middleware";
import { COMPACTION_OPTS, CompactionOptions } from "../middleware/compaction.options";
import { COMPACTION_STATE } from "../middleware/compaction-state";
import { AGENT_LOOP_DEFAULT } from "../middleware/loop-state";

function ctx(messages: any[]) {
  return { state: { messages }, loop: AGENT_LOOP_DEFAULT, config: {}, now: () => 0, interrupt: () => undefined, exit: () => ({}) } as any;
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

describe("CompactionMiddleware (drop)", () => {
  const opts = CompactionOptions.parse({ triggerAt: { messages: 6 }, keepRecent: 3 });

  it("carries the compaction-state marker", () => {
    expect((CompactionMiddleware as any)[COMPACTION_STATE]).toBe(true);
  });

  it("folds with RemoveMessage patches when over the trigger", async () => {
    const mw = new CompactionMiddleware(opts, {} as any);
    const patch: any = await mw.beforeModel(ctx(convo()));
    const removed = patch.messages.filter((m: any) => m instanceof RemoveMessage).map((m: any) => m.id);
    expect(removed).toEqual(["a1", "t1", "h2", "a2"]);
    expect(patch.summary).toBeUndefined(); // drop never writes a summary
  });

  it("no-ops when under the trigger", async () => {
    const mw = new CompactionMiddleware(opts, {} as any);
    const patch = await mw.beforeModel(ctx(convo().slice(0, 4)));
    expect(patch).toBeUndefined();
  });

  it("provideCompaction returns [opts provider, class]", () => {
    const providers = provideCompaction(opts);
    expect(providers[0]).toEqual({ provide: COMPACTION_OPTS, useValue: opts });
    expect(providers[1]).toBe(CompactionMiddleware);
  });
});
