import { StateSchema, MessagesValue } from "@langchain/langgraph";
import { HumanMessage, ToolMessage } from "@langchain/core/messages";
import {
  LangGraphAgent,
  CompactionMiddleware,
  provideCompaction,
  ManagedContextMiddleware,
  provideManagedContext,
} from "@harpua/langgraph";
import { createGraphTestingModule, type GraphTestingHarness } from "../testing-module";
import { ruleModel } from "../scripted-model";
import { OrderTools, OrderService } from "./fixtures";

/**
 * Builds a rule model that alternates: request a tool, then answer. Each
 * `.invoke()` therefore drives exactly one Human -> AI(tool) -> Tool ->
 * AI(answer) cycle (~4 messages of growth per invoke).
 */
function toolLoopModel() {
  return ruleModel()
    .onToolResult(() => "answered")
    .fallback({ toolCalls: [{ name: "lookup_order", args: { id: "1" } }] })
    .build();
}

describe("compaction e2e (drop, real checkpointer)", () => {
  let harness: GraphTestingHarness;

  afterEach(async () => {
    await harness?.close();
  });

  it("keeps persisted state bounded and never leaves a ToolMessage at the head across many turns", async () => {
    const CHAT = Symbol.for("e2e:model");
    const Model = toolLoopModel();

    @LangGraphAgent({
      name: "e2eAgent",
      state: new StateSchema({ messages: MessagesValue }),
      model: CHAT,
      tools: [OrderTools],
      middleware: [CompactionMiddleware],
    })
    class E2eAgent {}

    harness = await createGraphTestingModule({
      graphs: [E2eAgent],
      providers: [OrderTools, OrderService, { provide: CHAT, useClass: Model }],
      checkpointer: { type: "sqlite", path: ":memory:" },
      // BUDGET-style: featureProviders lands COMPACTION_OPTS in forFeature's
      // scope, where the agent's generated middleware node resolves it.
      featureProviders: provideCompaction({ triggerAt: { messages: 8 }, keepRecent: 4 }),
    });
    const agent = harness.get(E2eAgent);

    const counts: number[] = [];
    for (let i = 0; i < 10; i++) {
      const res: any = await agent.invoke(
        { messages: [new HumanMessage(`turn ${i}`)] },
        { configurable: { thread_id: "e2e" } },
      );
      counts.push(res.messages.length);
      // Head is never a ToolMessage: the HumanMessage-boundary cut holds.
      expect(res.messages[0]).not.toBeInstanceOf(ToolMessage);
      // State stays bounded near the trigger (allow one turn of overshoot);
      // if the fold weren't firing this would grow linearly past 40+.
      expect(res.messages.length).toBeLessThanOrEqual(12);
    }
    // Sanity: growth wasn't merely "always small" by construction — length did
    // climb toward the trigger at least once, proving the fold engaged rather
    // than never being exercised.
    expect(Math.max(...counts)).toBeGreaterThanOrEqual(7);
  });

  it("resumes correctly on a fresh invoke after folds have occurred", async () => {
    const CHAT = Symbol.for("e2e:resume:model");
    const Model = toolLoopModel();

    @LangGraphAgent({
      name: "resumeAgent",
      state: new StateSchema({ messages: MessagesValue }),
      model: CHAT,
      tools: [OrderTools],
      middleware: [CompactionMiddleware],
    })
    class ResumeAgent {}

    harness = await createGraphTestingModule({
      graphs: [ResumeAgent],
      providers: [OrderTools, OrderService, { provide: CHAT, useClass: Model }],
      checkpointer: { type: "sqlite", path: ":memory:" },
      featureProviders: provideCompaction({ triggerAt: { messages: 8 }, keepRecent: 4 }),
    });
    const agent = harness.get(ResumeAgent);
    const threadId = "e2e-resume";

    // Drive enough turns that at least one fold has definitely happened.
    for (let i = 0; i < 8; i++) {
      await agent.invoke(
        { messages: [new HumanMessage(`turn ${i}`)] },
        { configurable: { thread_id: threadId } },
      );
    }

    // A brand-new invoke on the SAME thread loads the (folded) checkpoint from
    // sqlite, doesn't crash, and produces a coherent answer.
    const res: any = await agent.invoke(
      { messages: [new HumanMessage("one more turn")] },
      { configurable: { thread_id: threadId } },
    );
    expect(res.messages[0]).not.toBeInstanceOf(ToolMessage);
    expect(res.messages.length).toBeLessThanOrEqual(12);
    const last = res.messages[res.messages.length - 1];
    expect(last.content).toBe("answered");
  });

  it("bundle equivalence: ManagedContextMiddleware yields the same bounded behavior as discrete CompactionMiddleware", async () => {
    const CHAT = Symbol.for("e2e:bundle:model");
    const Model = toolLoopModel();

    @LangGraphAgent({
      name: "bundleAgent",
      state: new StateSchema({ messages: MessagesValue }),
      model: CHAT,
      tools: [OrderTools],
      middleware: [ManagedContextMiddleware],
    })
    class BundleAgent {}

    harness = await createGraphTestingModule({
      graphs: [BundleAgent],
      providers: [OrderTools, OrderService, { provide: CHAT, useClass: Model }],
      checkpointer: { type: "sqlite", path: ":memory:" },
      featureProviders: provideManagedContext({ triggerAt: { messages: 8 }, keepRecent: 4 }),
    });
    const agent = harness.get(BundleAgent);

    const counts: number[] = [];
    for (let i = 0; i < 10; i++) {
      const res: any = await agent.invoke(
        { messages: [new HumanMessage(`turn ${i}`)] },
        { configurable: { thread_id: "e2e-bundle" } },
      );
      counts.push(res.messages.length);
      expect(res.messages[0]).not.toBeInstanceOf(ToolMessage);
      expect(res.messages.length).toBeLessThanOrEqual(12);
    }
    expect(Math.max(...counts)).toBeGreaterThanOrEqual(7);
  });
});
