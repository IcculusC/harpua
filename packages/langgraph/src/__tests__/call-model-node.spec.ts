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
      cost: 0,
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
      cost: 0,
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

  it("accumulates loop.cost via costOf, handing it the NORMALIZED reply", async () => {
    // The fixture reply is a duck-typed foreign object (dual-package case):
    // costOf must receive the reconstructed AIMessage — not the raw model
    // output — so a cost model reading response_metadata.tokenUsage works
    // for every reply shape. usage_metadata is deliberately absent: on an
    // OpenRouter stack the provider cost rides response_metadata only.
    const foreignReply = {
      content: "y",
      response_metadata: { tokenUsage: { cost: 0.25, total_tokens: 10 } },
    };
    const fakeModel = { invoke: async () => foreignReply };
    const recordingMw = new RecordingMw();
    const stubModuleRef = {
      get(token: unknown) {
        if (token === MODEL_TOKEN) return fakeModel;
        if (token === RecordingMw) return recordingMw;
        throw new Error(`unexpected token: ${String(token)}`);
      },
    };

    const seen: unknown[] = [];
    const CallModelNode = makeCallModelNode({
      modelToken: MODEL_TOKEN,
      wrapMiddleware: [RecordingMw],
      costOf: (reply) => {
        seen.push(reply);
        return (reply.response_metadata as any).tokenUsage.cost;
      },
    });
    const node = new CallModelNode(stubModuleRef as any);

    const result = await node.run(
      {
        messages: [new HumanMessage("q")],
        loop: { ...AGENT_LOOP_DEFAULT, cost: 0.5 },
      },
      {} as any,
    );

    expect(seen).toHaveLength(1);
    expect(isAIMessage(seen[0])).toBe(true);
    expect(result.loop!.cost).toBeCloseTo(0.75, 10);
  });

  it("treats a pre-cost checkpointed loop (no cost field) as cost 0 instead of NaN", async () => {
    // A thread checkpointed under a version whose LoopInfo had no `cost`
    // resumes with `loop.cost === undefined`; `undefined + delta` is NaN and
    // NaN accumulates forever. Migration must be implicit: absent reads as 0.
    const fakeModel = {
      invoke: async () => new AIMessage({ content: "hi" }),
    };
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
      costOf: () => 0.25,
    });
    const node = new CallModelNode(stubModuleRef as any);

    const staleLoop: any = { iteration: 3, modelCalls: 3, toolCalls: 1, tokens: 50, startedAt: 100 };
    const result = await node.run(
      { messages: [new HumanMessage("q")], loop: staleLoop },
      {} as any,
    );

    expect(result.loop!.cost).toBeCloseTo(0.25, 10);
  });

  it("keeps loop.cost at its prior value when no costOf is configured", async () => {
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
        throw new Error(`unexpected token: ${String(token)}`);
      },
    };

    const CallModelNode = makeCallModelNode({
      modelToken: MODEL_TOKEN,
      wrapMiddleware: [RecordingMw],
    });
    const node = new CallModelNode(stubModuleRef as any);

    const result = await node.run(
      { messages: [new HumanMessage("q")], loop: { ...AGENT_LOOP_DEFAULT, cost: 0.5 } },
      {} as any,
    );

    expect(result.loop!.cost).toBe(0.5);
  });

  it("throws a named error when costOf returns a non-finite number", async () => {
    // NaN poisons the accumulator silently: NaN >= maxCost is false forever,
    // so the budget cap the app believes it configured can never fire again.
    // A broken cost model must fail loud on the cycle that broke, not
    // disarm the guard.
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
        throw new Error(`unexpected token: ${String(token)}`);
      },
    };

    const CallModelNode = makeCallModelNode({
      modelToken: MODEL_TOKEN,
      wrapMiddleware: [RecordingMw],
      costOf: () => Number.NaN,
    });
    const node = new CallModelNode(stubModuleRef as any);

    await expect(
      node.run(
        { messages: [new HumanMessage("q")], loop: AGENT_LOOP_DEFAULT },
        {} as any,
      ),
    ).rejects.toThrow(/costOf returned a non-finite number/);
  });

  it("reconstruction keeps response_metadata, additional_kwargs, invalid_tool_calls, and name", async () => {
    // response_metadata carries the FALLBACK token counts the compaction
    // signal reads when a provider omits usage_metadata (walkie report 007);
    // dropping it in reconstruction would kill that fallback for every
    // chunk/foreign-copy reply. additional_kwargs carries provider extras
    // (legacy function_call, reasoning traces) with the same stakes. The
    // fixture is a duck-typed plain object — the dual-package hazard case
    // (a reply from a different @langchain/core copy fails instanceof) —
    // because a real AIMessageChunk constructor discards a directly-passed
    // invalid_tool_calls (chunks derive it from tool_call_chunks).
    const foreignReply = {
      content: "y",
      name: "assistant-a",
      response_metadata: {
        tokenUsage: { prompt_tokens: 131935, completion_tokens: 121, total_tokens: 132056 },
        finish_reason: "stop",
      },
      additional_kwargs: { reasoning: "because" },
      invalid_tool_calls: [
        { name: "x", args: "{broken", id: "bad1", error: "parse", type: "invalid_tool_call" },
      ],
    };
    expect(foreignReply instanceof AIMessage).toBe(false);

    const fakeModel = { invoke: async () => foreignReply };
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

    const reply = result.messages![0] as AIMessage;
    expect(isAIMessage(reply)).toBe(true);
    expect(reply.response_metadata).toEqual({
      tokenUsage: { prompt_tokens: 131935, completion_tokens: 121, total_tokens: 132056 },
      finish_reason: "stop",
    });
    expect(reply.additional_kwargs).toEqual({ reasoning: "because" });
    expect(reply.invalid_tool_calls).toEqual([
      { name: "x", args: "{broken", id: "bad1", error: "parse", type: "invalid_tool_call" },
    ]);
    expect(reply.name).toBe("assistant-a");
  });
});
