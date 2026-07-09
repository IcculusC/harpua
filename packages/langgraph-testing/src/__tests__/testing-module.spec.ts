import {
  createGraphTestingModule,
  type GraphTestingHarness,
} from "../testing-module";
import { expectInterrupt } from "../interrupt-helpers";
import { ruleModel } from "../scripted-model";
import { StateSchema, MessagesValue } from "@langchain/langgraph";
import { HumanMessage } from "@langchain/core/messages";
import { LangGraphAgent, BudgetMiddleware, provideBudget } from "@harpua/langgraph";
import {
  AskHumanNode,
  CounterStateT,
  HilGraph,
  HilStateT,
  LinearGraph,
  NodeA,
  NodeB,
  OrderService,
  OrderTools,
} from "./fixtures";

describe("createGraphTestingModule", () => {
  let harness: GraphTestingHarness;

  afterEach(async () => {
    await harness?.close();
  });

  it("boots a graph and returns its facade via the class getter", async () => {
    harness = await createGraphTestingModule({
      graphs: [LinearGraph],
      providers: [NodeA, NodeB],
    });
    const graph = harness.get<CounterStateT>(LinearGraph);
    const result = await graph.invoke({ steps: [], total: 0 });
    expect(result.steps).toEqual(["A", "B"]);
    expect(result.total).toBe(2);
  });

  it("resolves a facade by name too", async () => {
    harness = await createGraphTestingModule({
      graphs: [LinearGraph],
      providers: [NodeA, NodeB],
    });
    const graph = harness.getByName<CounterStateT>("linear");
    const result = await graph.invoke({ steps: [], total: 0 });
    expect(result.steps).toEqual(["A", "B"]);
  });

  it("exposes app + module for arbitrary provider access", async () => {
    harness = await createGraphTestingModule({
      graphs: [LinearGraph],
      providers: [NodeA, NodeB],
    });
    expect(harness.app.get(NodeA)).toBeInstanceOf(NodeA);
    expect(harness.module.get(NodeB)).toBeInstanceOf(NodeB);
  });

  it("throws for a non-graph class", async () => {
    harness = await createGraphTestingModule({
      graphs: [LinearGraph],
      providers: [NodeA, NodeB],
    });
    expect(() => harness.get(NodeA)).toThrow(
      /is not a @LangGraph-decorated class/,
    );
  });

  it("defaults to the memory checkpointer (interrupt/resume works)", async () => {
    harness = await createGraphTestingModule({
      graphs: [HilGraph],
      providers: [AskHumanNode],
    });
    const hil = harness.get<HilStateT>(HilGraph);
    const paused = await hil.invoke(
      { question: "Name?", answer: "" },
      { configurable: { thread_id: "mem-1" } },
    );
    expect(expectInterrupt<string>(paused)).toBe("Name?");
    const done = await hil.resume("mem-1", "Ada");
    expect(done.answer).toBe("Ada");
  });

  it("supports sqlite ':memory:' for a real serialize/deserialize path", async () => {
    harness = await createGraphTestingModule({
      graphs: [HilGraph],
      providers: [AskHumanNode],
      checkpointer: { type: "sqlite", path: ":memory:" },
    });
    const hil = harness.get<HilStateT>(HilGraph);
    const threadId = "sqlite-1";
    const paused = await hil.invoke(
      { question: "Name?", answer: "" },
      { configurable: { thread_id: threadId } },
    );
    expect(expectInterrupt<string>(paused)).toBe("Name?");
    const done = await hil.resume(threadId, "Grace");
    expect(done.answer).toBe("Grace");
  });

  it("wires a @LangGraphAgent's middleware options via featureProviders", async () => {
    const CHAT = Symbol.for("cgtm:budget-model");
    // Always requests a tool → loops forever unless a Budget stops it.
    const AlwaysTool = ruleModel()
      .fallback({ toolCalls: [{ name: "lookup_order", args: { id: "1" } }] })
      .build();

    @LangGraphAgent({
      name: "budgetedAgent",
      state: new StateSchema({ messages: MessagesValue }),
      model: CHAT,
      tools: [OrderTools],
      middleware: [BudgetMiddleware],
    })
    class BudgetedAgent {}

    harness = await createGraphTestingModule({
      graphs: [BudgetedAgent],
      providers: [OrderTools, OrderService, { provide: CHAT, useClass: AlwaysTool }],
      // BUDGET_OPTS must land in forFeature's scope — the agent's generated
      // middleware nodes resolve it there, not from the top-level providers.
      featureProviders: provideBudget({
        maxCycles: 2,
        maxToolCalls: 999,
        maxTokens: 999_999,
        maxWallMs: 999_999,
      }),
    });

    const agent = harness.get(BudgetedAgent);
    const result: any = await agent.invoke({
      messages: [new HumanMessage("go")],
    });
    // Boots only because featureProviders wired BUDGET_OPTS into forFeature's
    // scope; Budget then caps the otherwise-infinite tool loop at maxCycles.
    expect(result.loop.iteration).toBeLessThanOrEqual(2);
  });
});
