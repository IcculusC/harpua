import { Injectable } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import type { INestApplication } from "@nestjs/common";
import { AIMessage, HumanMessage, ToolMessage } from "@langchain/core/messages";
import type { BaseMessage } from "@langchain/core/messages";
import { StateSchema, MessagesValue } from "@langchain/langgraph";
import { tool } from "@langchain/core/tools";
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
  TOOLS,
  defineEdges,
  route,
  getGraphFacadeToken,
  type StateOf,
  type LangGraphRunnable,
} from "../index";
import { resetOtelCache } from "../observability";
import { OrderService, OrderTools } from "./fixtures";

const MessagesState = new StateSchema({ messages: MessagesValue });
type MsgState = StateOf<typeof MessagesState>;

// A raw LangChain tool instance (not a provider class). Records its calls so a
// test can prove it actually ran when mounted alongside a provider class.
const echoCalls: string[] = [];
const echoTool = tool(
  (input: { text: string }) => {
    echoCalls.push(input.text);
    return `echoed:${input.text}`;
  },
  {
    name: "echo",
    description: "Echo the given text back.",
    schema: z.object({ text: z.string() }),
  },
);

// Deterministic model node: first pass asks for the raw `echo` tool, then, once
// the tool result is present, produces a final reply.
@Injectable()
class EchoModel implements NodeHandler<MsgState> {
  run(state: MsgState) {
    const last = state.messages[state.messages.length - 1];
    if (last instanceof ToolMessage) {
      return { messages: [new AIMessage(`done: ${String(last.content)}`)] };
    }
    return {
      messages: [
        new AIMessage({
          content: "",
          tool_calls: [
            { name: "echo", args: { text: "hi" }, id: "c1", type: "tool_call" },
          ],
        }),
      ],
    };
  }
}

function hasToolCalls(state: MsgState): typeof TOOLS | typeof END {
  const last = state.messages[state.messages.length - 1];
  return last instanceof AIMessage && (last.tool_calls?.length ?? 0) > 0
    ? TOOLS
    : END;
}

// Mixed array: a DI provider class AND a raw tool instance.
@LangGraph({ name: "rawMixed", state: MessagesState, tools: [OrderTools, echoTool] })
class RawMixedGraph {
  edges = defineEdges<MsgState>([
    { from: START, to: EchoModel },
    { from: EchoModel, to: route<MsgState>(hasToolCalls, [TOOLS, END]) },
    { from: TOOLS, to: EchoModel },
  ]);
}

// A graph whose tools entry is neither a provider class nor a raw tool.
@LangGraph({ name: "rawBad", state: MessagesState, tools: [{ not: "a tool" } as any] })
class RawBadGraph {
  edges = defineEdges<MsgState>([
    { from: START, to: EchoModel },
    { from: EchoModel, to: route<MsgState>(hasToolCalls, [TOOLS, END]) },
    { from: TOOLS, to: EchoModel },
  ]);
}

describe("raw LangChain tools in the tools array", () => {
  beforeEach(() => {
    echoCalls.length = 0;
  });

  it("mounts a raw tool alongside a provider class and executes it through the graph", async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        LangGraphModule.forRoot(),
        LangGraphModule.forFeature([RawMixedGraph]),
      ],
      providers: [EchoModel, OrderService, OrderTools],
    }).compile();
    const app = moduleRef.createNestApplication();
    await app.init();
    try {
      const agent = app.get<LangGraphRunnable<MsgState>>(
        getGraphFacadeToken({ name: "rawMixed" }),
      );
      const result = (await agent.invoke({
        messages: [new HumanMessage("go")],
      })) as { messages: BaseMessage[] };

      // The raw tool ran (side effect) and produced its ToolMessage.
      expect(echoCalls).toEqual(["hi"]);
      const toolMessages = result.messages.filter(
        (m) => m instanceof ToolMessage,
      ) as ToolMessage[];
      expect(toolMessages).toHaveLength(1);
      expect(String(toolMessages[0].content)).toBe("echoed:hi");

      const last = result.messages[result.messages.length - 1];
      expect(last).toBeInstanceOf(AIMessage);
      expect(String(last.content)).toContain("echoed:hi");
    } finally {
      await app.close();
    }
  });

  it("fails fast when a tools entry is neither a provider class nor a raw tool", async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        LangGraphModule.forRoot(),
        LangGraphModule.forFeature([RawBadGraph]),
      ],
      providers: [EchoModel],
    }).compile();
    const app = moduleRef.createNestApplication();
    try {
      await expect(app.init()).rejects.toThrow(
        /is neither a tool provider class nor a raw LangChain tool instance/,
      );
    } finally {
      await app.close();
    }
  });
});

describe("raw tool observability", () => {
  const exporter = new InMemorySpanExporter();
  const provider = new NodeTracerProvider({
    spanProcessors: [new SimpleSpanProcessor(exporter)],
  });
  let app: INestApplication;
  let agent: LangGraphRunnable<MsgState>;

  beforeAll(async () => {
    provider.register();
    const moduleRef = await Test.createTestingModule({
      imports: [
        LangGraphModule.forRoot({ checkpointer: { type: "memory" } }),
        LangGraphModule.forFeature([RawMixedGraph]),
      ],
      providers: [EchoModel, OrderService, OrderTools],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    agent = app.get(getGraphFacadeToken({ name: "rawMixed" }));
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
    echoCalls.length = 0;
  });

  it("emits a langgraph.tool <name> span for a raw tool, nested under the tools node", async () => {
    await agent.invoke({ messages: [new HumanMessage("go")] });

    const toolsNode = exporter
      .getFinishedSpans()
      .filter((s: ReadableSpan) => s.name === "langgraph.node tools");
    const toolSpans = exporter
      .getFinishedSpans()
      .filter((s: ReadableSpan) => s.name === "langgraph.tool echo");

    expect(toolsNode).toHaveLength(1);
    expect(toolSpans).toHaveLength(1);
    expect(toolSpans[0].attributes["langgraph.tool.name"]).toBe("echo");
    expect(toolSpans[0].parentSpanContext?.spanId).toBe(
      toolsNode[0].spanContext().spanId,
    );
  });
});
