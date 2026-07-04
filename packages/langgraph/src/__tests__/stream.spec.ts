import { Injectable } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import type { INestApplication } from "@nestjs/common";
import { HumanMessage, isAIMessage } from "@langchain/core/messages";

import {
  LangGraphModule,
  InjectLangGraphRunnable,
  getGraphFacadeToken,
  getStreamedInterrupts,
  type LangGraphRunnable,
} from "../index";
import {
  AgentGraph,
  AskHumanNode,
  CallModel,
  CounterStateT,
  HilGraph,
  HilStateT,
  IncrementService,
  LinearGraph,
  MsgState,
  NodeA,
  NodeB,
  OrderService,
  OrderTools,
} from "./fixtures";

async function collect<T>(stream: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const chunk of stream) out.push(chunk);
  return out;
}

@Injectable()
class StreamConsumer {
  constructor(
    @InjectLangGraphRunnable(LinearGraph)
    public readonly linear: LangGraphRunnable<CounterStateT>,
    @InjectLangGraphRunnable(AgentGraph)
    public readonly agent: LangGraphRunnable<MsgState>,
  ) {}
}

describe("LangGraph streaming facade", () => {
  let app: INestApplication;
  let consumer: StreamConsumer;
  let hil: LangGraphRunnable<HilStateT>;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        LangGraphModule.forRoot({ checkpointer: { type: "memory" } }),
        LangGraphModule.forFeature([LinearGraph, AgentGraph, HilGraph]),
      ],
      providers: [
        IncrementService,
        NodeA,
        NodeB,
        CallModel,
        OrderService,
        OrderTools,
        AskHumanNode,
        StreamConsumer,
      ],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    consumer = app.get(StreamConsumer);
    hil = app.get<LangGraphRunnable<HilStateT>>(
      getGraphFacadeToken({ name: "hil" }),
    );
  });

  afterAll(async () => {
    await app?.close();
  });

  it("stream() yields per-node updates in the default (updates) mode", async () => {
    const chunks = await collect(
      await consumer.linear.stream({ steps: [], total: 0 }),
    );
    // One update chunk per node, keyed by node id.
    expect(chunks.map((c) => Object.keys(c)[0])).toEqual(["NodeA", "NodeB"]);
    expect((chunks[0] as Record<string, CounterStateT>).NodeA.steps).toEqual([
      "A",
    ]);
    expect((chunks[1] as Record<string, CounterStateT>).NodeB.total).toBe(2);
  });

  it("streamUpdates() matches stream() and names each node", async () => {
    const chunks = await collect(
      await consumer.linear.streamUpdates({ steps: [], total: 0 }),
    );
    expect(chunks.map((c) => Object.keys(c)[0])).toEqual(["NodeA", "NodeB"]);
  });

  it("streamValues() yields full state snapshots, ending with the final state", async () => {
    const chunks = await collect(
      await consumer.linear.streamValues({ steps: [], total: 0 }),
    );
    // Initial snapshot + one per node.
    expect(chunks[0]).toEqual({ steps: [], total: 0 });
    const last = chunks[chunks.length - 1] as CounterStateT;
    expect(last.steps).toEqual(["A", "B"]);
    expect(last.total).toBe(2);
  });

  it("streamMessages() yields [message, metadata] tuples for emitted messages", async () => {
    const chunks = await collect(
      await consumer.agent.streamMessages({
        messages: [new HumanMessage("look it up")],
      }),
    );
    expect(chunks.length).toBeGreaterThan(0);
    const [message, metadata] = chunks[0];
    expect(typeof (message as { _getType?: unknown })._getType).toBe(
      "function",
    );
    expect(metadata).toBeInstanceOf(Object);
    // The agent finishes with a plain assistant message.
    const aiTexts = chunks
      .map(([m]) => m)
      .filter((m) => isAIMessage(m))
      .map((m) =>
        typeof m.content === "string" ? m.content : JSON.stringify(m.content),
      );
    expect(aiTexts.join("\n")).toContain("Your order is shipped.");
  });

  it("streamModes() yields typed [mode, chunk] tuples for multiple modes", async () => {
    const chunks = await collect(
      await consumer.linear.streamModes({ steps: [], total: 0 }, [
        "updates",
        "values",
      ]),
    );
    const modes = new Set(chunks.map(([mode]) => mode));
    expect(modes).toEqual(new Set(["updates", "values"]));
    // Discriminated union narrows correctly at the value level.
    for (const chunk of chunks) {
      if (chunk[0] === "values") {
        expect(chunk[1]).toHaveProperty("steps");
      } else {
        expect(Object.keys(chunk[1])[0]).toMatch(/Node[AB]/);
      }
    }
  });

  it("runs a tool node in the stream, surfacing a 'tools' update", async () => {
    const chunks = await collect(
      await consumer.agent.streamUpdates({
        messages: [new HumanMessage("look up order 42")],
      }),
    );
    const nodeIds = chunks.map((c) => Object.keys(c)[0]);
    expect(nodeIds).toContain("tools");
    expect(nodeIds).toContain("CallModel");
  });

  it("emits an interrupt terminator chunk when a node interrupts mid-stream", async () => {
    const threadId = "stream-hil-1";
    const chunks = await collect(
      await hil.streamUpdates(
        { question: "What is your name?", answer: "" },
        { configurable: { thread_id: threadId } },
      ),
    );
    // The final chunk carries the interrupt; the stream ends after it.
    const last = chunks[chunks.length - 1];
    const interrupts = getStreamedInterrupts(last);
    expect(interrupts).toBeDefined();
    expect(interrupts![0].value).toBe("What is your name?");

    // Detection also works while iterating; resume() then completes the run.
    const done = await hil.resume(threadId, "Ada");
    expect(done.answer).toBe("Ada");
  });

  it("auto-fills an ephemeral thread_id when streaming without one", async () => {
    // No configurable.thread_id supplied — must not throw despite the graph
    // carrying a checkpointer.
    const chunks = await collect(
      await consumer.linear.stream({ steps: [], total: 0 }),
    );
    expect(chunks.length).toBe(2);
  });
});
