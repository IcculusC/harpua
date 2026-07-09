import { StateSchema, MessagesValue } from "@langchain/langgraph";
import { AIMessage } from "@langchain/core/messages";
import { z } from "zod";

import { START, END, TOOLS, isRouteMarker } from "../index";
import { getGraphMetadata } from "../decorators";
import { LangGraphMiddleware } from "../middleware/middleware.decorator";
import { LangGraphAgent, getAgentMetadata } from "../agent/agent.decorator";
import { lowerAgent } from "../agent/agent-compiler";
import { OrderTools } from "./fixtures";
import type { GraphEdge, RouteMarker } from "../interfaces";

const CHAT_MODEL = Symbol.for("test:CHAT_MODEL");

@LangGraphMiddleware()
class BootStub {
  beforeAgent() {
    return {};
  }
}

@LangGraphMiddleware()
class BudgetStub {
  beforeModel() {
    return {};
  }
}

@LangGraphMiddleware()
class TrimStub {
  // Implements a node hook + a wrap hook -> must be partitioned into both.
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
  middleware: [BootStub, BudgetStub, TrimStub],
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

const channelsOf = (AgentClass: unknown): string[] =>
  Object.keys((getGraphMetadata(AgentClass)!.state as StateSchema<any>).getChannels());

const toolMessage = new AIMessage({
  content: "",
  tool_calls: [{ name: "lookup_order", args: { id: "1" }, id: "c1", type: "tool_call" }],
});
const plainMessage = new AIMessage("done");

describe("@LangGraphAgent lowering", () => {
  it("applies @LangGraph with a state carrying reserved loop + exit channels", () => {
    const meta = getGraphMetadata(BuddyAgent);
    expect(meta).toBeDefined();
    expect(meta!.name).toBe("buddy");
    expect(meta!.tools).toEqual([OrderTools]);
    expect(channelsOf(BuddyAgent)).toEqual(
      expect.arrayContaining(["messages", "loop", "exit"]),
    );
  });

  it("declares an `outcome` channel only when responseFormat is set", () => {
    expect(channelsOf(StructuredAgent)).toContain("outcome");
    expect(channelsOf(BuddyAgent)).not.toContain("outcome");
  });

  it("exposes the agent options via getAgentMetadata", () => {
    const opts = getAgentMetadata(BuddyAgent);
    expect(opts).toBeDefined();
    expect(opts!.name).toBe("buddy");
    expect(opts!.model).toBe(CHAT_MODEL);
    expect(opts!.middleware).toEqual([BootStub, BudgetStub, TrimStub]);
  });

  it("generates a CallModelNode plus one hook node per implemented hook", () => {
    const names = lowerAgent(BuddyAgent).generatedNodes.map((n) => n.name);
    expect(names.some((n) => /CallModel/.test(n))).toBe(true);
    expect(names.some((n) => /beforeAgent/.test(n))).toBe(true); // BootStub
    expect(names.some((n) => /beforeModel/.test(n))).toBe(true); // BudgetStub
    expect(names.some((n) => /afterModel/.test(n))).toBe(true); // TrimStub
  });

  it("partitions wrap middleware separately from node-hook middleware", () => {
    const lowered = lowerAgent(BuddyAgent);
    expect(lowered.wrapModelMiddleware).toContain(TrimStub); // wrapModelCall
    expect(lowered.wrapToolMiddleware).toEqual([]);
    expect(typeof lowered.modelToken).toBe("symbol");
  });

  it("rejects node-scoped middleware ({ use, on }) loudly at build time", () => {
    expect(() =>
      LangGraphAgent({
        name: "scoped",
        state: new StateSchema({ messages: MessagesValue }),
        model: CHAT_MODEL,
        middleware: [{ use: BudgetStub, on: OrderTools }],
      })(class Scoped {}),
    ).toThrow(/node-scoped middleware/);
  });

  it("assembles START, a model router over [TOOLS, exit], and a TOOLS loop-back", () => {
    const edges = edgesOf(BuddyAgent);
    expect(edges.some((e) => e.from === START)).toBe(true);
    expect(edges.some((e) => e.from === TOOLS)).toBe(true);

    const routerEdge = edges.find(
      (e) =>
        isRouteMarker(e.to) && (e.to as RouteMarker<any>).pathMap?.includes(TOOLS),
    );
    expect(routerEdge).toBeDefined();
    const router = routerEdge!.to as RouteMarker<any>;
    expect(router.pathMap).toEqual(expect.arrayContaining([TOOLS, END]));

    // Exercise the router: exit wins; else tool_calls -> TOOLS; else exit(END).
    expect(router.fn({ exit: { requested: true }, messages: [] } as any)).toBe(END);
    expect(
      router.fn({ exit: { requested: false }, messages: [toolMessage] } as any),
    ).toBe(TOOLS);
    expect(
      router.fn({ exit: { requested: false }, messages: [plainMessage] } as any),
    ).toBe(END);
  });

  it("routes hook nodes conditionally so a hook can short-circuit to the exit", () => {
    const edges = edgesOf(BuddyAgent);
    const conditional = edges.filter(
      (e) =>
        isRouteMarker(e.to) &&
        !(e.to as RouteMarker<any>).pathMap?.includes(TOOLS),
    );
    expect(conditional.length).toBeGreaterThan(0);
    for (const e of conditional) {
      const marker = e.to as RouteMarker<any>;
      expect(marker.pathMap).toHaveLength(2); // [exitTarget, next]
      // Exercise the fn: exit flag -> exitTarget (pathMap[0]); else -> next (pathMap[1]).
      expect(marker.fn({ exit: { requested: true } } as any)).toBe(marker.pathMap![0]);
      expect(marker.fn({ exit: { requested: false } } as any)).toBe(marker.pathMap![1]);
    }
  });

  it("loops back through the beforeModel chain, never re-running beforeAgent", () => {
    const edges = edgesOf(BuddyAgent);
    const loopBack = edges.find((e) => e.from === TOOLS)!;
    const targetName = (loopBack.to as { name: string }).name;
    expect(targetName).not.toMatch(/beforeAgent/);
    expect(targetName).toMatch(/beforeModel|CallModel/);
  });

  it("with responseFormat, generates a StructuredResponseNode and routes the loop exit to it", () => {
    const lowered = lowerAgent(StructuredAgent);
    const structuredNode = lowered.generatedNodes.find((n) =>
      /StructuredResponse/.test(n.name),
    )!;
    expect(structuredNode).toBeDefined();

    const edges = edgesOf(StructuredAgent);
    const router = edges.find(
      (e) =>
        isRouteMarker(e.to) && (e.to as RouteMarker<any>).pathMap?.includes(TOOLS),
    )!.to as RouteMarker<any>;

    expect(router.pathMap).toContain(structuredNode);
    expect(router.pathMap).not.toContain(END);

    // Exit target is the structured node; exit flag beats a pending tool call.
    expect(
      router.fn({ exit: { requested: false }, messages: [plainMessage] } as any),
    ).toBe(structuredNode);
    expect(
      router.fn({ exit: { requested: true }, messages: [toolMessage] } as any),
    ).toBe(structuredNode);
    expect(
      router.fn({ exit: { requested: false }, messages: [toolMessage] } as any),
    ).toBe(TOOLS);

    // The structured node flows onward to END.
    expect(edges.some((e) => e.from === structuredNode && e.to === END)).toBe(true);
  });

  it("lowers systemPrompt to a generated wrap-model middleware", () => {
    const names = lowerAgent(PromptedAgent).wrapModelMiddleware.map((n) => n.name);
    expect(names.some((n) => /SystemPrompt/.test(n))).toBe(true);
  });
});
