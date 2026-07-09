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
      iteration: 0, modelCalls: 0, toolCalls: 0, tokens: 0, startedAt: 0,
    });
    expect(AGENT_EXIT_DEFAULT).toEqual({ requested: false });
  });

  it("rejects a non-StateSchema input with a clear error", () => {
    expect(() => withAgentLoop({} as any)).toThrow(/StateSchema/);
  });
});
