import { StateSchema, MessagesValue } from "@langchain/langgraph";
import {
  withAgentLoop,
  AGENT_LOOP_DEFAULT,
  AGENT_EXIT_DEFAULT,
} from "../middleware/loop-state";

describe("loop-state", () => {
  it("adds loop and exit channels defaulting to zeros/unrequested, preserving existing fields", () => {
    const base = new StateSchema({ messages: MessagesValue });
    const merged = withAgentLoop(base);
    const channels = merged.getChannels();
    expect(Object.keys(channels)).toEqual(
      expect.arrayContaining(["messages", "loop", "exit"]),
    );
    // default value flows through a compiled read (smoke): the loop field exists
    expect(AGENT_LOOP_DEFAULT).toEqual({
      iteration: 0, modelCalls: 0, toolCalls: 0, tokens: 0, cost: 0, startedAt: 0,
    });
    expect(AGENT_EXIT_DEFAULT).toEqual({ requested: false });
  });

  it("rejects a non-StateSchema input with a clear error", () => {
    expect(() => withAgentLoop({} as any)).toThrow(/StateSchema/);
  });

  it("heals a pre-cost loop (no cost field) to cost 0 at schema validation", () => {
    // LangGraph validates EVERY node/updateState write against the field
    // schema. A `loop` spread from a checkpoint written before `cost`
    // existed (wall-credit facade resume, beforeAgent hook writes under
    // reset:"thread") reaches that validation without the key — a required
    // `cost` hard-crashes the resume of every pre-cost thread, so the
    // property-level default must fill it there.
    const preCost = {
      iteration: 3,
      modelCalls: 3,
      toolCalls: 1,
      tokens: 50,
      startedAt: 100,
    };
    const { LoopInfo } = jest.requireActual("../middleware/loop-state");
    expect(LoopInfo.parse(preCost)).toEqual({ ...preCost, cost: 0 });
  });
});
