import { HumanMessage, AIMessage, ToolMessage } from "@langchain/core/messages";
import { computeFold } from "../middleware/compaction-cut";

function convo() {
  return [
    new HumanMessage({ id: "h1", content: "goal" }),      // 0 head/pin
    new AIMessage({ id: "a1", content: "", tool_calls: [{ name: "t", args: {}, id: "c1", type: "tool_call" }] }), // 1
    new ToolMessage({ id: "t1", content: "res", tool_call_id: "c1" }), // 2
    new HumanMessage({ id: "h2", content: "next" }),      // 3
    new AIMessage({ id: "a2", content: "ok" }),           // 4
    new HumanMessage({ id: "h3", content: "more" }),      // 5 recent
    new AIMessage({ id: "a3", content: "sure" }),         // 6 recent
  ];
}

describe("computeFold", () => {
  it("snaps the cut FORWARD to a HumanMessage so no tool result is stranded", () => {
    // keepRecent=3 => naive cut at index 4 (an AIMessage). Must snap forward to h3 @5.
    const plan = computeFold(convo(), { keepRecent: 3, pin: (m) => (m as any).id === "h1" });
    expect(plan).not.toBeNull();
    // head h1 retained; folds a1,t1,h2,a2 (ids); retained tail starts at h3.
    expect(plan!.removeIds).toEqual(["a1", "t1", "h2", "a2"]);
    expect(plan!.foldedSpan.map((m) => (m as any).id)).toEqual(["a1", "t1", "h2", "a2"]);
  });

  it("skips messages without ids (cannot RemoveMessage them)", () => {
    const msgs = convo();
    (msgs[1] as any).id = undefined; // a1 has no id
    const plan = computeFold(msgs, { keepRecent: 3, pin: (m) => (m as any).id === "h1" });
    expect(plan!.removeIds).toEqual(["t1", "h2", "a2"]); // a1 omitted
  });

  it("returns null when there is no HumanMessage boundary to cut at", () => {
    const msgs = [new HumanMessage({ id: "h1", content: "g" }), new AIMessage({ id: "a1", content: "x" })];
    expect(computeFold(msgs, { keepRecent: 1, pin: (m) => (m as any).id === "h1" })).toBeNull();
  });
});
