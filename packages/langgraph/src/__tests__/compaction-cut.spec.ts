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

describe("mid-turn fold (walkie 012)", () => {
  // A long tool loop: the protected tail is ALL ai/tool, so the forward scan
  // finds no human and the fold used to return null every cycle — exactly the
  // turns that need relief got none. The safe boundary sits BEHIND the
  // window: the running turn's own HumanMessage.
  function midTurn() {
    const msgs: any[] = [
      new HumanMessage({ id: "h1", content: "goal" }), // 0 pin
      new AIMessage({ id: "a1", content: "ok" }),       // 1
      new HumanMessage({ id: "h2", content: "old turn" }), // 2
      new AIMessage({ id: "a2", content: "done" }),     // 3
      new HumanMessage({ id: "h3", content: "design the board" }), // 4 running turn
    ];
    for (let i = 0; i < 6; i++) {
      msgs.push(new AIMessage({ id: `loop-a${i}`, content: "", tool_calls: [{ name: "t", args: {}, id: `c${i}`, type: "tool_call" }] }));
      msgs.push(new ToolMessage({ id: `loop-t${i}`, content: "res", tool_call_id: `c${i}` }));
    }
    return msgs; // 17 messages, last human at index 4
  }

  it("falls back to the LAST human at/before the naive cut when the tail is all ai/tool", () => {
    // keepRecent=4 => naive cut at 13, no human at/after it. Backward
    // fallback cuts at h3 @4: keeps MORE than keepRecent (safe), retained
    // history opens on a human, folded span = h1..h3 exclusive.
    const plan = computeFold(midTurn(), { keepRecent: 4, pin: (m) => (m as any).id === "h1" });
    expect(plan).not.toBeNull();
    expect(plan!.foldedSpan.map((m) => (m as any).id)).toEqual(["a1", "h2", "a2"]);
    expect(plan!.removeIds).toEqual(["a1", "h2", "a2"]);
  });

  it("still returns null when the only human at/before the cut is the pinned head's neighbor", () => {
    // Nothing foldable between head and the running turn.
    const msgs: any[] = [
      new HumanMessage({ id: "h1", content: "goal" }),
      new HumanMessage({ id: "h2", content: "turn" }),
      new AIMessage({ id: "a1", content: "x" }),
      new ToolMessage({ id: "t1", content: "r", tool_call_id: "c" }),
    ];
    expect(computeFold(msgs, { keepRecent: 1, pin: (m) => (m as any).id === "h1" })).toBeNull();
  });

  it("prefers the forward boundary when one exists (between-turn behavior unchanged)", () => {
    const plan = computeFold(convo(), { keepRecent: 3, pin: (m) => (m as any).id === "h1" });
    expect(plan!.foldedSpan.map((m) => (m as any).id)).toEqual(["a1", "t1", "h2", "a2"]);
  });
});
