import { HumanMessage } from "@langchain/core/messages";

import { collectStream, collectUntilInterrupt } from "../stream-collectors";
import { scriptedModel } from "../scripted-model";
import {
  createGraphTestingModule,
  type GraphTestingHarness,
} from "../testing-module";
import {
  AgentGraph,
  CallModel,
  CHAT_MODEL,
  CounterStateT,
  HilGraph,
  HilStateT,
  AskHumanNode,
  LinearGraph,
  NodeA,
  NodeB,
  OrderService,
  OrderTools,
  type AgentStateT,
} from "./fixtures";

describe("collectStream", () => {
  let harness: GraphTestingHarness;

  afterEach(async () => {
    await harness?.close();
  });

  it("drains an updates stream into an ordered array", async () => {
    harness = await createGraphTestingModule({
      graphs: [LinearGraph],
      providers: [NodeA, NodeB],
    });
    const graph = harness.get<CounterStateT>(LinearGraph);
    const chunks = await collectStream(
      await graph.stream({ steps: [], total: 0 }),
    );
    expect(chunks.map((c) => Object.keys(c)[0])).toEqual(["NodeA", "NodeB"]);
  });

  it("collects a tools update in an agentic loop", async () => {
    const Model = scriptedModel()
      .toolCall("lookup_order", { id: "42" })
      .say("done")
      .build();
    harness = await createGraphTestingModule({
      graphs: [AgentGraph],
      providers: [
        CallModel,
        OrderTools,
        OrderService,
        { provide: CHAT_MODEL, useClass: Model },
      ],
    });
    const agent = harness.get<AgentStateT>(AgentGraph);
    const chunks = await collectStream(
      await agent.streamUpdates({ messages: [new HumanMessage("go")] }),
    );
    const nodes = chunks.map((c) => Object.keys(c)[0]);
    expect(nodes).toContain("tools");
    expect(nodes).toContain("CallModel");
  });
});

describe("collectUntilInterrupt", () => {
  let harness: GraphTestingHarness;

  afterEach(async () => {
    await harness?.close();
  });

  it("splits ordinary chunks from the interrupt terminator, enabling resume", async () => {
    harness = await createGraphTestingModule({
      graphs: [HilGraph],
      providers: [AskHumanNode],
    });
    const hil = harness.get<HilStateT>(HilGraph);
    const threadId = "collect-hil-1";

    const { chunks, interrupts } = await collectUntilInterrupt(
      await hil.streamUpdates(
        { question: "What is your name?", answer: "" },
        { configurable: { thread_id: threadId } },
      ),
    );

    expect(interrupts).toBeDefined();
    expect(interrupts?.[0].value).toBe("What is your name?");
    // The terminator chunk is not included among the ordinary chunks.
    for (const chunk of chunks) {
      expect(chunk).not.toHaveProperty("__interrupt__");
    }

    const done = await hil.resume(threadId, "Ada");
    expect(done.answer).toBe("Ada");
  });

  it("returns undefined interrupts for a stream that never pauses", async () => {
    harness = await createGraphTestingModule({
      graphs: [LinearGraph],
      providers: [NodeA, NodeB],
    });
    const graph = harness.get<CounterStateT>(LinearGraph);
    const { chunks, interrupts } = await collectUntilInterrupt(
      await graph.streamUpdates({ steps: [], total: 0 }),
    );
    expect(interrupts).toBeUndefined();
    expect(chunks).toHaveLength(2);
  });
});
