import { HumanMessage, isAIMessage, type UsageMetadata } from "@langchain/core/messages";
import { BaseChatModel } from "@langchain/core/language_models/chat_models";

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

  it("builds a real BaseChatModel driven with .invoke()", async () => {
    const Model = scriptedModel()
      .toolCall("lookup_order", { id: "7" })
      .say("done")
      .build();
    const model = new Model();
    // It is a genuine BaseChatModel, not a bespoke shape.
    expect(model).toBeInstanceOf(BaseChatModel);
    expect(model._llmType()).toBe("harpua-scripted-fake");
    // bindTools must not crash (tools bind at the ToolNode level for us).
    expect(model.bindTools([])).toBe(model);

    const message = await model.invoke([new HumanMessage("hi")]);
    expect(message.tool_calls?.[0]).toEqual({
      name: "lookup_order",
      args: { id: "7" },
      id: "call_1_1",
      type: "tool_call",
    });
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

  it("rejects with a helpful error when the script is exhausted", async () => {
    const Model = scriptedModel().say("only turn").build();
    const model = new Model();
    await model.invoke([new HumanMessage("a")]);
    await expect(model.invoke([new HumanMessage("b")])).rejects.toThrow(
      /ran out of scripted turns/,
    );
  });

  it("reset() rewinds the sequence", async () => {
    const Model = scriptedModel().say("one").say("two").build();
    const model = new Model();
    expect(textOf(await model.invoke([]))).toBe("one");
    model.reset();
    expect(textOf(await model.invoke([]))).toBe("one");
  });

  it("stamps usage_metadata on a scripted reply when provided", async () => {
    const usage: UsageMetadata = { input_tokens: 12, output_tokens: 5, total_tokens: 17 };
    const Model = scriptedModel().say("hi", { usage }).build();
    const model = new Model();
    const res = await model._generate([new HumanMessage("yo")]);
    expect(res.generations[0].message.usage_metadata).toEqual(usage);
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

  it("is a BaseChatModel and falls back when no rule matches", async () => {
    const Model = ruleModel().fallback("fallback reply").build();
    const model = new Model();
    expect(model).toBeInstanceOf(BaseChatModel);
    expect(textOf(await model.invoke([new HumanMessage("random")]))).toBe(
      "fallback reply",
    );
  });

  it("supports additional_kwargs for approval-style flags", async () => {
    const Model = ruleModel()
      .onHuman(/cancel/i, {
        text: "I need your approval.",
        additionalKwargs: { pending_action: { action: "cancel_order" } },
      })
      .build();
    const model = new Model();
    const message = await model.invoke([
      new HumanMessage("please cancel order 7"),
    ]);
    expect(message.additional_kwargs.pending_action).toEqual({
      action: "cancel_order",
    });
  });
});
