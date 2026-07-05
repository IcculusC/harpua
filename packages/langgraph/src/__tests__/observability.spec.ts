import { Injectable } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import type { INestApplication } from "@nestjs/common";
import { HumanMessage } from "@langchain/core/messages";
import { context, trace } from "@opentelemetry/api";
import type { ReadableSpan } from "@opentelemetry/sdk-trace-node";
import {
  InMemorySpanExporter,
  NodeTracerProvider,
  SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-node";
import { z } from "zod";

import {
  LangGraph,
  LangGraphModule,
  NodeHandler,
  START,
  END,
  defineEdges,
  getGraphFacadeToken,
  type LangGraphRunnable,
} from "../index";
import * as optionalRequire from "../optional-require";
import { resetOtelCache } from "../observability";
import {
  AgentGraph,
  CallModel,
  CounterStateT,
  IncrementService,
  LinearGraph,
  MsgState,
  NodeA,
  NodeB,
  OrderService,
  OrderTools,
} from "./fixtures";

/* A graph whose single node throws, to exercise error span semantics. */
const BoomState = z.object({ done: z.boolean() });
type BoomStateT = z.infer<typeof BoomState>;

@Injectable()
class BoomNode implements NodeHandler<BoomStateT> {
  run(): never {
    throw new Error("node exploded");
  }
}

@LangGraph({ name: "boom", state: BoomState })
class BoomGraph {
  edges = defineEdges<BoomStateT>([
    { from: START, to: BoomNode },
    { from: BoomNode, to: END },
  ]);
}

const exporter = new InMemorySpanExporter();
const provider = new NodeTracerProvider({
  spanProcessors: [new SimpleSpanProcessor(exporter)],
});

function byName(name: string): ReadableSpan[] {
  return exporter.getFinishedSpans().filter((s) => s.name === name);
}
function one(name: string): ReadableSpan {
  const spans = byName(name);
  expect(spans).toHaveLength(1);
  return spans[0];
}
function parentIdOf(span: ReadableSpan): string | undefined {
  return span.parentSpanContext?.spanId;
}

describe("OpenTelemetry graph instrumentation", () => {
  let app: INestApplication;
  let linear: LangGraphRunnable<CounterStateT>;
  let agent: LangGraphRunnable<MsgState>;
  let boom: LangGraphRunnable<BoomStateT>;

  beforeAll(async () => {
    provider.register();
    const moduleRef = await Test.createTestingModule({
      imports: [
        LangGraphModule.forRoot({ checkpointer: { type: "memory" } }),
        LangGraphModule.forFeature([LinearGraph, AgentGraph, BoomGraph]),
      ],
      providers: [
        IncrementService,
        NodeA,
        NodeB,
        CallModel,
        OrderService,
        OrderTools,
        BoomNode,
      ],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    linear = app.get(getGraphFacadeToken({ name: "linear" }));
    agent = app.get(getGraphFacadeToken({ name: "agent" }));
    boom = app.get(getGraphFacadeToken({ name: "boom" }));
  });

  afterAll(async () => {
    await app?.close();
    await provider.shutdown();
    trace.disable();
    context.disable();
  });

  beforeEach(() => {
    resetOtelCache();
    exporter.reset();
  });

  it("nests node spans under the graph span (invoke)", async () => {
    await linear.invoke({ steps: [], total: 0 });

    const graph = one("langgraph.graph linear");
    const nodeA = one("langgraph.node NodeA");
    const nodeB = one("langgraph.node NodeB");

    expect(parentIdOf(graph)).toBeUndefined();
    expect(parentIdOf(nodeA)).toBe(graph.spanContext().spanId);
    expect(parentIdOf(nodeB)).toBe(graph.spanContext().spanId);
  });

  it("nests tool spans under the tools node span, under the graph span", async () => {
    await agent.invoke({ messages: [new HumanMessage("look up order 42")] });

    const graph = one("langgraph.graph agent");
    const toolsNode = one("langgraph.node tools");
    const tool = one("langgraph.tool lookup_order");

    expect(parentIdOf(toolsNode)).toBe(graph.spanContext().spanId);
    expect(parentIdOf(tool)).toBe(toolsNode.spanContext().spanId);
    // CallModel runs before and after the tool call -> two node spans.
    expect(byName("langgraph.node CallModel")).toHaveLength(2);
  });

  it("sets stable, low-cardinality attributes without message/tool payloads", async () => {
    await agent.invoke(
      { messages: [new HumanMessage("look up order 42")] },
      { configurable: { thread_id: "attr-thread" } },
    );

    const graph = one("langgraph.graph agent");
    expect(graph.attributes["langgraph.graph.name"]).toBe("agent");
    expect(graph.attributes["langgraph.thread_id"]).toBe("attr-thread");

    const callModel = byName("langgraph.node CallModel")[0];
    expect(callModel.attributes["langgraph.node.name"]).toBe("CallModel");
    expect(callModel.attributes["langgraph.graph.name"]).toBe("agent");
    expect(callModel.attributes["langgraph.thread_id"]).toBe("attr-thread");

    const tool = one("langgraph.tool lookup_order");
    expect(tool.attributes["langgraph.tool.name"]).toBe("lookup_order");
    // No message contents / tool args leak into attributes.
    const allValues = exporter
      .getFinishedSpans()
      .flatMap((s) => Object.values(s.attributes).map(String));
    expect(allValues.some((v) => v.includes("42"))).toBe(false);
  });

  it("marks node and graph spans as errored and rethrows", async () => {
    await expect(boom.invoke({ done: false })).rejects.toThrow("node exploded");

    const node = one("langgraph.node BoomNode");
    const graph = one("langgraph.graph boom");
    // SpanStatusCode.ERROR === 2
    expect(node.status.code).toBe(2);
    expect(graph.status.code).toBe(2);
    expect(node.events.some((e) => e.name === "exception")).toBe(true);
  });

  it("does not instrument (and never crashes) when @opentelemetry/api is absent", async () => {
    jest
      .spyOn(optionalRequire, "requireOptionalModule")
      .mockImplementation((pkg: string) => {
        const err = new Error(`Cannot find module '${pkg}'`) as NodeJS.ErrnoException;
        err.code = "MODULE_NOT_FOUND";
        throw err;
      });
    resetOtelCache();

    const result = await linear.invoke({ steps: [], total: 0 });
    expect(result.steps).toEqual(["A", "B"]);
    expect(exporter.getFinishedSpans()).toHaveLength(0);

    jest.restoreAllMocks();
    resetOtelCache();
  });

  it("keeps the graph span open until the stream iterator is fully consumed", async () => {
    const stream = await linear.stream({ steps: [], total: 0 });
    const iterator = stream[Symbol.asyncIterator]();

    // Pull the first super-step: a node span may have finished, but the graph
    // span must still be open (absent from the exporter's finished list).
    const first = await iterator.next();
    expect(first.done).toBe(false);
    expect(byName("langgraph.graph linear")).toHaveLength(0);

    // Drain the rest.
    let step = await iterator.next();
    while (!step.done) step = await iterator.next();

    // Now the graph span is closed and exported, parenting the node spans.
    const graph = one("langgraph.graph linear");
    expect(parentIdOf(one("langgraph.node NodeA"))).toBe(
      graph.spanContext().spanId,
    );
    expect(parentIdOf(one("langgraph.node NodeB"))).toBe(
      graph.spanContext().spanId,
    );
  });
});
