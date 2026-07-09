import {
  AIMessage,
  AIMessageChunk,
  HumanMessage,
  isAIMessage,
} from "@langchain/core/messages";
import { makeCallModelNode } from "../agent/call-model-node";
import { AGENT_LOOP_DEFAULT } from "../middleware/loop-state";

class RecordingMw {
  ran = false;
  async wrapModelCall(req: any, next: any) {
    this.ran = true;
    return next(req);
  }
}

const MODEL_TOKEN = "MODEL_TOKEN";
const CLOCK_TOKEN = "CLOCK_TOKEN";

describe("makeCallModelNode", () => {
  it("appends the model reply and bumps loop bookkeeping, anchoring startedAt from the injected clock on the first turn", async () => {
    const fakeModel = {
      invoke: async () =>
        new AIMessage({
          content: "hi",
          usage_metadata: { input_tokens: 1, output_tokens: 2, total_tokens: 3 },
        }),
    };
    const recordingMw = new RecordingMw();
    const stubModuleRef = {
      get(token: unknown) {
        if (token === MODEL_TOKEN) return fakeModel;
        if (token === RecordingMw) return recordingMw;
        if (token === CLOCK_TOKEN) return () => 7000;
        throw new Error(`unexpected token: ${String(token)}`);
      },
    };

    const CallModelNode = makeCallModelNode({
      modelToken: MODEL_TOKEN,
      wrapMiddleware: [RecordingMw],
      clockToken: CLOCK_TOKEN,
    });
    const node = new CallModelNode(stubModuleRef as any);

    const humanMessage = new HumanMessage("q");
    const result = await node.run(
      { messages: [humanMessage], loop: AGENT_LOOP_DEFAULT },
      {} as any,
    );

    expect(result.messages).toHaveLength(1);
    const reply = result.messages![0] as AIMessage;
    expect(reply.content).toBe("hi");
    // startedAt was the un-anchored 0 sentinel -> stamped from the clock.
    expect(result.loop).toEqual({
      iteration: 1,
      modelCalls: 1,
      toolCalls: 0,
      tokens: 3,
      startedAt: 7000,
    });
    expect(recordingMw.ran).toBe(true);
  });

  it("preserves an already-anchored startedAt instead of overwriting it with the clock", async () => {
    const fakeModel = {
      invoke: async () =>
        new AIMessage({
          content: "hi",
          usage_metadata: { input_tokens: 1, output_tokens: 2, total_tokens: 3 },
        }),
    };
    const recordingMw = new RecordingMw();
    const stubModuleRef = {
      get(token: unknown) {
        if (token === MODEL_TOKEN) return fakeModel;
        if (token === RecordingMw) return recordingMw;
        if (token === CLOCK_TOKEN) return () => 7000;
        throw new Error(`unexpected token: ${String(token)}`);
      },
    };

    const CallModelNode = makeCallModelNode({
      modelToken: MODEL_TOKEN,
      wrapMiddleware: [RecordingMw],
      clockToken: CLOCK_TOKEN,
    });
    const node = new CallModelNode(stubModuleRef as any);

    // A prior turn (or a beforeAgent hook) already anchored startedAt at 100.
    const result = await node.run(
      {
        messages: [new HumanMessage("q")],
        loop: { ...AGENT_LOOP_DEFAULT, iteration: 1, modelCalls: 1, startedAt: 100 },
      },
      {} as any,
    );

    expect(result.loop).toEqual({
      iteration: 2,
      modelCalls: 2,
      toolCalls: 0,
      tokens: 3,
      startedAt: 100,
    });
  });

  it("reconstructs an AIMessage from a non-AIMessage chunk, preserving tool_calls, usage_metadata, and id", async () => {
    // The real production path: GraphBoundModel.invoke returns an AIMessageChunk,
    // NOT an AIMessage, so `out instanceof AIMessage` is false and the node
    // reconstructs a fresh AIMessage. The reconstruction must carry through
    // tool_calls (the agent loop's router depends on them) and usage_metadata.
    const chunk = new AIMessageChunk({
      content: "call a tool",
      id: "run-42",
      tool_calls: [{ name: "x", args: {}, id: "c1", type: "tool_call" }],
      usage_metadata: { input_tokens: 2, output_tokens: 3, total_tokens: 5 },
    });
    expect(chunk instanceof AIMessage).toBe(false);

    const fakeModel = { invoke: async () => chunk };
    const recordingMw = new RecordingMw();
    const stubModuleRef = {
      get(token: unknown) {
        if (token === MODEL_TOKEN) return fakeModel;
        if (token === RecordingMw) return recordingMw;
        throw new Error(`unexpected token: ${String(token)}`);
      },
    };

    const CallModelNode = makeCallModelNode({
      modelToken: MODEL_TOKEN,
      wrapMiddleware: [RecordingMw],
    });
    const node = new CallModelNode(stubModuleRef as any);

    const result = await node.run(
      { messages: [new HumanMessage("q")], loop: AGENT_LOOP_DEFAULT },
      {} as any,
    );

    expect(result.messages).toHaveLength(1);
    const reply = result.messages![0] as AIMessage;
    expect(isAIMessage(reply)).toBe(true);
    expect(reply.content).toBe("call a tool");
    expect(reply.id).toBe("run-42");
    expect(reply.tool_calls).toEqual([
      { name: "x", args: {}, id: "c1", type: "tool_call" },
    ]);
    expect(reply.usage_metadata).toEqual({
      input_tokens: 2,
      output_tokens: 3,
      total_tokens: 5,
    });
    expect(result.loop!.tokens).toBe(5);
    // `reply.tool_calls` (1 entry) must bump `loop.toolCalls` -- otherwise
    // BudgetMiddleware's `maxToolCalls` cap (which reads `ctx.loop.toolCalls`)
    // never sees a nonzero count and can never fire.
    expect(result.loop!.toolCalls).toBe(1);
  });
});
