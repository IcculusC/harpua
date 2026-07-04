import { Test } from "@nestjs/testing";
import type { INestApplication } from "@nestjs/common";
import { HumanMessage, ToolMessage, AIMessage } from "@langchain/core/messages";
import type { BaseMessage } from "@langchain/core/messages";

import {
  LangGraphModule,
  GraphRecursionError,
  getGraphFacadeToken,
  type LangGraphRunnable,
} from "../index";
import {
  AgentGraph,
  CallModel,
  LoopGraph,
  AlwaysToolModel,
  OrderService,
  OrderTools,
} from "./fixtures";

describe("LangGraph agentic loop", () => {
  let app: INestApplication;
  let agent: LangGraphRunnable;
  let orderService: OrderService;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        LangGraphModule.forRoot(),
        LangGraphModule.forFeature([AgentGraph, LoopGraph]),
      ],
      providers: [CallModel, AlwaysToolModel, OrderService, OrderTools],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    agent = app.get<LangGraphRunnable>(getGraphFacadeToken({ name: "agent" }));
    orderService = app.get(OrderService);
  });

  afterAll(async () => {
    await app?.close();
  });

  it("runs model -> TOOLS -> model and executes the tool via its injected service", async () => {
    const result = (await agent.invoke({
      messages: [new HumanMessage("Where is order 42?")],
    })) as { messages: BaseMessage[] };

    // The tool actually ran (via the DI-provided OrderService).
    expect(orderService.calls).toContain("42");

    const toolMessages = result.messages.filter(
      (m) => m instanceof ToolMessage,
    ) as ToolMessage[];
    expect(toolMessages).toHaveLength(1);
    expect(String(toolMessages[0].content)).toContain("shipped");

    const last = result.messages[result.messages.length - 1];
    expect(last).toBeInstanceOf(AIMessage);
    expect(String(last.content)).toContain("shipped");
  });

  it("applies the per-graph default recursionLimit (tight limit -> GraphRecursionError)", async () => {
    // The facade applies the graph's default recursionLimit (3) automatically;
    // no recursionLimit is passed at the call site.
    const loop = app.get<LangGraphRunnable>(
      getGraphFacadeToken({ name: "loop" }),
    );
    await expect(
      loop.invoke({ messages: [new HumanMessage("loop")] }),
    ).rejects.toBeInstanceOf(GraphRecursionError);
  });
});
