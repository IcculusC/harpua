import { HumanMessage, isAIMessage } from "@langchain/core/messages";

import { scriptedModel, ruleModel, textOf } from "../scripted-model";
import {
  createGraphTestingModule,
  type GraphTestingHarness,
} from "../testing-module";
import {
  AgentGraph,
  CallModel,
  CHAT_MODEL,
  OrderService,
  OrderTools,
  type AgentStateT,
} from "./fixtures";

describe("scriptedModel (sequence)", () => {
  let harness: GraphTestingHarness;
  const orders = new OrderService();

  afterEach(async () => {
    await harness?.close();
    orders.calls.length = 0;
  });

  it("drives a real agentic loop: tool call then plain reply", async () => {
    const Model = scriptedModel()
      .toolCall("lookup_order", { id: "42" })
      .say("Your order is shipped.")
      .build();

    harness = await createGraphTestingModule({
      graphs: [AgentGraph],
      providers: [
        CallModel,
        OrderTools,
        { provide: OrderService, useValue: orders },
        { provide: CHAT_MODEL, useClass: Model },
      ],
    });

    const agent = harness.get<AgentStateT>(AgentGraph);
    const result = await agent.invoke({
      messages: [new HumanMessage("look up my order")],
    });

    // The real tool ran through DI.
    expect(orders.calls).toEqual(["42"]);
    const texts = result.messages
      .filter((m) => isAIMessage(m))
      .map((m) => textOf(m));
    expect(texts).toContain("Your order is shipped.");
  });

  it("emits a well-formed tool_call with an auto-assigned id", async () => {
    const Model = scriptedModel().toolCall("lookup_order", { id: "7" }).build();
    const model = new Model();
    const message = model.respond([new HumanMessage("hi")]);
    expect(message.tool_calls?.[0]).toEqual({
      name: "lookup_order",
      args: { id: "7" },
      id: "call_1_1",
      type: "tool_call",
    });
  });

  it("throws a helpful error when the script is exhausted", () => {
    const Model = scriptedModel().say("only turn").build();
    const model = new Model();
    model.respond([new HumanMessage("a")]);
    expect(() => model.respond([new HumanMessage("b")])).toThrow(
      /ran out of scripted turns/,
    );
  });

  it("reset() rewinds the sequence", () => {
    const Model = scriptedModel().say("one").say("two").build();
    const model = new Model();
    expect(textOf(model.respond([]))).toBe("one");
    model.reset?.();
    expect(textOf(model.respond([]))).toBe("one");
  });
});

describe("ruleModel (match on latest turn)", () => {
  let harness: GraphTestingHarness;
  const orders = new OrderService();

  afterEach(async () => {
    await harness?.close();
    orders.calls.length = 0;
  });

  it("matches a human turn to a tool call, then summarizes the tool result", async () => {
    const Model = ruleModel()
      .onToolResult((last) => `Here's what I found: ${textOf(last)}`)
      .onHuman(/order\s+#?([A-Za-z0-9-]+)/i, (_text, match) => ({
        toolCalls: [{ name: "lookup_order", args: { id: match[1] } }],
      }))
      .fallback("Hi! I can check an order for you.")
      .build();

    harness = await createGraphTestingModule({
      graphs: [AgentGraph],
      providers: [
        CallModel,
        OrderTools,
        { provide: OrderService, useValue: orders },
        { provide: CHAT_MODEL, useClass: Model },
      ],
    });

    const agent = harness.get<AgentStateT>(AgentGraph);
    const result = await agent.invoke({
      messages: [new HumanMessage("what's the status of order 42?")],
    });

    expect(orders.calls).toEqual(["42"]);
    const reply = result.messages
      .filter((m) => isAIMessage(m))
      .map((m) => textOf(m))
      .join("\n");
    expect(reply).toContain("Here's what I found");
    expect(reply).toContain("Order 42: shipped");
  });

  it("falls back when no rule matches", () => {
    const Model = ruleModel().fallback("fallback reply").build();
    const model = new Model();
    expect(textOf(model.respond([new HumanMessage("random")]))).toBe(
      "fallback reply",
    );
  });

  it("supports additional_kwargs for approval-style flags", () => {
    const Model = ruleModel()
      .onHuman(/cancel/i, {
        text: "I need your approval.",
        additionalKwargs: { pending_action: { action: "cancel_order" } },
      })
      .build();
    const model = new Model();
    const message = model.respond([new HumanMessage("please cancel order 7")]);
    expect(message.additional_kwargs.pending_action).toEqual({
      action: "cancel_order",
    });
  });
});
