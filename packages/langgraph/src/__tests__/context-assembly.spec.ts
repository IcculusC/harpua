import { HumanMessage, AIMessage, ToolMessage, SystemMessage, isHumanMessage } from "@langchain/core/messages";
import { renderSummary, assembleWindow, evictOldToolOutputs } from "../middleware/context-assembly";
import { CACHE_BOUNDARY } from "../middleware/cache-markers";

const SUMMARY = { goal: "g", keyDecisions: ["d1"], openQuestions: [], artifacts: ["f.ts"], currentState: "mid" };

describe("context-assembly", () => {
  it("renders a summary deterministically", () => {
    expect(renderSummary(SUMMARY).content).toBe(renderSummary(SUMMARY).content);
    expect(String(renderSummary(SUMMARY).content)).toContain("g");
  });

  it("inserts the summary after the pinned head and marks boundaries", () => {
    const msgs = [new HumanMessage({ id: "h1", content: "goal" }), new AIMessage({ id: "a1", content: "hi" })];
    const out = assembleWindow(msgs, SUMMARY, { pin: (m) => (m as any).id === "h1", cacheHints: true });
    // out[0] is a CLONE of the head, not the persisted original — marking must
    // never mutate checkpoint state, so reference equality with msgs[0] is
    // intentionally NOT expected here (see the non-mutation regression test below).
    expect(out[0]).not.toBe(msgs[0]);
    expect(out[0]).toBeInstanceOf(HumanMessage);
    expect((out[0] as any).id).toBe("h1");
    expect(out[0].content).toBe(msgs[0].content);
    expect(out[1]).toBeInstanceOf(SystemMessage); // summary second
    expect(out[2]).toBe(msgs[1]);                 // tail after
    expect((out[0].additional_kwargs as any)[CACHE_BOUNDARY]).toBe(true);
    expect((out[1].additional_kwargs as any)[CACHE_BOUNDARY]).toBe(true);
  });

  it("passes messages through unchanged when summary is null", () => {
    const msgs = [new HumanMessage({ id: "h1", content: "g" })];
    expect(assembleWindow(msgs, null, { pin: isHumanMessage, cacheHints: false })).toEqual(msgs);
  });

  it("evicts old tool outputs to a stub", () => {
    const msgs = [
      new ToolMessage({ id: "t1", content: "huge old output", tool_call_id: "c1" }),
      new HumanMessage({ id: "h2", content: "recent" }),
    ];
    const out = evictOldToolOutputs(msgs, 1);
    expect(String(out[0].content)).toBe("[tool output elided]");
    expect(out[1]).toBe(msgs[1]);
  });

  it("never mutates the persisted head message when stamping cache boundaries", () => {
    const msgs = [new HumanMessage({ id: "h1", content: "goal" }), new AIMessage({ id: "a1", content: "hi" })];
    assembleWindow(msgs, SUMMARY, { pin: (m) => (m as any).id === "h1", cacheHints: true });
    expect((msgs[0].additional_kwargs as any)[CACHE_BOUNDARY]).toBeUndefined();
  });

  it("renders unchanged when no epilogue is given", () => {
    expect(String(renderSummary(SUMMARY, null).content)).toBe(String(renderSummary(SUMMARY).content));
  });

  it("appends the epilogue as the final line of the rendered summary", () => {
    const out = String(renderSummary(SUMMARY, "check the NOTEBOOK").content);
    expect(out.split("\n").pop()).toBe("check the NOTEBOOK");
    expect(out).toContain("Current state: mid");
  });

  it("ignores an empty epilogue", () => {
    expect(String(renderSummary(SUMMARY, "").content)).toBe(String(renderSummary(SUMMARY).content));
  });

  it("renders the epilogue through assembleWindow", () => {
    const msgs = [new HumanMessage({ id: "h1", content: "goal" })];
    const out = assembleWindow(msgs, SUMMARY, {
      pin: (m) => (m as any).id === "h1",
      cacheHints: false,
      summaryEpilogue: "check the NOTEBOOK",
    });
    expect(String(out[1].content)).toContain("check the NOTEBOOK");
  });
});
