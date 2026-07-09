import { Injectable } from "@nestjs/common";
import { StateSchema, MessagesValue } from "@langchain/langgraph";
import { z } from "zod";

import { START, END, TOOLS, isRouteMarker } from "../index";
import { getGraphMetadata } from "../decorators";
import { LangGraphMiddleware } from "../middleware/middleware.decorator";
import { LangGraphAgent, getAgentMetadata } from "../agent/agent.decorator";
import { lowerAgent } from "../agent/agent-compiler";
import { OrderTools } from "./fixtures";
import type { GraphEdge, RouteMarker } from "../interfaces";

const CHAT_MODEL = Symbol.for("test:CHAT_MODEL");
const SYSTEM_PROMPT_TOKEN = Symbol.for("test:SYSTEM_PROMPT");

@LangGraphMiddleware()
class BudgetStub {
  beforeModel() {
    return {};
  }
}

@LangGraphMiddleware()
class TrimStub {
  // Implements two node hooks + a wrap hook -> must be partitioned into all three.
  afterModel() {
    return {};
  }
  wrapModelCall(req: any, next: any) {
    return next(req);
  }
}

const BaseState = new StateSchema({ messages: MessagesValue });

@LangGraphAgent({
  name: "buddy",
  state: BaseState,
  model: CHAT_MODEL,
  tools: [OrderTools],
  middleware: [BudgetStub, TrimStub],
})
class BuddyAgent {}

const AnswerSchema = z.object({ answer: z.string() });

@LangGraphAgent({
  name: "structured",
  state: new StateSchema({ messages: MessagesValue }),
  model: CHAT_MODEL,
  tools: [OrderTools],
  middleware: [BudgetStub],
  responseFormat: AnswerSchema,
})
class StructuredAgent {}

@LangGraphAgent({
  name: "prompted",
  state: new StateSchema({ messages: MessagesValue }),
  model: CHAT_MODEL,
  systemPrompt: "You are Buddy.",
})
class PromptedAgent {}

function edgesOf(AgentClass: new () => any): GraphEdge<any>[] {
  return (new AgentClass() as { edges: GraphEdge<any>[] }).edges;
}

describe("@LangGraphAgent lowering", () => {
  it("applies @LangGraph with a state carrying reserved loop + exit channels", () => {
    const meta = getGraphMetadata(BuddyAgent);
    expect(meta).toBeDefined();
    expect(meta!.name).toBe("buddy");
    expect(meta!.tools).toEqual([OrderTools]);

    const channels = (meta!.state as StateSchema<any>).getChannels();
    expect(Object.keys(channels)).toEqual(
      expect.arrayContaining(["messages", "loop", "exit"]),
    );
  });

  it("exposes the agent options via getAgentMetadata", () => {
    const opts = getAgentMetadata(BuddyAgent);
    expect(opts).toBeDefined();
    expect(opts!.name).toBe("buddy");
    expect(opts!.model).toBe(CHAT_MODEL);
    expect(opts!.middleware).toEqual([BudgetStub, TrimStub]);
  });

  it("generates a CallModelNode plus one hook node per implemented hook", () => {
    const lowered = lowerAgent(BuddyAgent);
    const names = lowered.generatedNodes.map((n) => n.name);

    expect(names.some((n) => /CallModel/.test(n))).toBe(true);
    // BudgetStub.beforeModel -> a beforeModel hook node.
    expect(names.some((n) => /beforeModel/.test(n))).toBe(true);
    // TrimStub.afterModel -> an afterModel hook node.
    expect(names.some((n) => /afterModel/.test(n))).toBe(true);
  });

  it("partitions wrap middleware separately from node-hook middleware", () => {
    const lowered = lowerAgent(BuddyAgent);
    // TrimStub implements wrapModelCall.
    expect(lowered.wrapModelMiddleware).toContain(TrimStub);
    // No wrapToolCall implementors.
    expect(lowered.wrapToolMiddleware).toEqual([]);
    // Its internal bound-model token is a unique symbol.
    expect(typeof lowered.modelToken).toBe("symbol");
  });

  it("assembles START, a model router over [TOOLS, exit], and a TOOLS loop-back", () => {
    const edges = edgesOf(BuddyAgent);

    expect(edges.some((e) => e.from === START)).toBe(true);
    expect(edges.some((e) => e.from === TOOLS)).toBe(true);

    // The model router is the route edge whose pathMap includes TOOLS.
    const routerEdge = edges.find(
      (e) =>
        isRouteMarker(e.to) &&
        (e.to as RouteMarker<any>).pathMap?.includes(TOOLS),
    );
    expect(routerEdge).toBeDefined();
    const marker = routerEdge!.to as RouteMarker<any>;
    // Without responseFormat, the exit target is END.
    expect(marker.pathMap).toEqual(expect.arrayContaining([TOOLS, END]));
  });

  it("routes hook nodes conditionally so a hook can short-circuit to the exit", () => {
    const edges = edgesOf(BuddyAgent);
    // Every conditional route edge that is NOT the model router targets exactly
    // [exitTarget, nextTarget] (2 entries), i.e. a conditionalNext.
    const conditional = edges.filter(
      (e) =>
        isRouteMarker(e.to) &&
        !(e.to as RouteMarker<any>).pathMap?.includes(TOOLS),
    );
    expect(conditional.length).toBeGreaterThan(0);
    for (const e of conditional) {
      expect((e.to as RouteMarker<any>).pathMap).toHaveLength(2);
    }
  });

  it("with responseFormat, generates a StructuredResponseNode and routes the loop exit to it", () => {
    const lowered = lowerAgent(StructuredAgent);
    const names = lowered.generatedNodes.map((n) => n.name);
    expect(names.some((n) => /StructuredResponse/.test(n))).toBe(true);

    const structuredNode = lowered.generatedNodes.find((n) =>
      /StructuredResponse/.test(n.name),
    )!;

    const edges = edgesOf(StructuredAgent);
    const routerEdge = edges.find(
      (e) =>
        isRouteMarker(e.to) &&
        (e.to as RouteMarker<any>).pathMap?.includes(TOOLS),
    )!;
    const marker = routerEdge.to as RouteMarker<any>;
    // Exit target is the StructuredResponseNode, NOT END.
    expect(marker.pathMap).toContain(structuredNode);
    expect(marker.pathMap).not.toContain(END);

    // The structured node flows onward to END.
    expect(
      edges.some((e) => e.from === structuredNode && e.to === END),
    ).toBe(true);
  });

  it("lowers systemPrompt to a generated wrap-model middleware", () => {
    const lowered = lowerAgent(PromptedAgent);
    const names = lowered.wrapModelMiddleware.map((n) => n.name);
    expect(names.some((n) => /SystemPrompt/.test(n))).toBe(true);
  });
});
