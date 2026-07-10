import { StateSchema, MessagesValue } from "@langchain/langgraph";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import {
  LangGraphAgent,
  CompactionMiddleware,
  provideCompaction,
  ContextWindowMiddleware,
  provideContextWindow,
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
      // Head is always the original first HumanMessage: the fold pins
      // messages[0..headIndex] and cuts only at HumanMessage boundaries, so the
      // head can never become a Tool- OR AIMessage.
      expect(res.messages[0]).toBeInstanceOf(HumanMessage);
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

    // Drive enough turns that at least one fold has definitely happened, and
    // record each turn's persisted length so we can PROVE a fold engaged.
    const warmupCounts: number[] = [];
    for (let i = 0; i < 8; i++) {
      const warm: any = await agent.invoke(
        { messages: [new HumanMessage(`turn ${i}`)] },
        { configurable: { thread_id: threadId } },
      );
      warmupCounts.push(warm.messages.length);
    }
    // A fold provably engaged during warm-up (length climbed to the trigger and
    // was then cut back), so the resume invoke below resumes a COMPACTED
    // checkpoint — not merely a short thread that never needed folding.
    expect(Math.max(...warmupCounts)).toBeGreaterThanOrEqual(8);

    // A brand-new invoke on the SAME thread loads the (folded) checkpoint from
    // sqlite, doesn't crash, and produces a coherent answer.
    const res: any = await agent.invoke(
      { messages: [new HumanMessage("one more turn")] },
      { configurable: { thread_id: threadId } },
    );
    expect(res.messages[0]).toBeInstanceOf(HumanMessage);
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
      expect(res.messages[0]).toBeInstanceOf(HumanMessage);
      expect(res.messages.length).toBeLessThanOrEqual(12);
    }
    expect(Math.max(...counts)).toBeGreaterThanOrEqual(7);
  });
});

describe("compaction e2e (summarize, real fold + view)", () => {
  let harness: GraphTestingHarness;

  afterEach(async () => {
    await harness?.close();
  });

  it("folds via summarize and renders the written summary into a later model call", async () => {
    const CHAT = Symbol.for("e2e:summarize:model");
    // The scripted summary: `goal` is the needle we look for in the rendered
    // SystemMessage the view (ContextWindowMiddleware) assembles from the
    // `summary` channel the fold (CompactionMiddleware) wrote.
    const SUMMARY = {
      goal: "ship the quarterly report by friday, distinctive-goal-marker",
      keyDecisions: ["use the new template"],
      openQuestions: ["who reviews it"],
      artifacts: ["report.docx"],
      currentState: "drafting",
    };

    // Records every turn's assembled `req.messages` (post-view) so we can
    // inspect what the model actually received, mirroring the prefix-stability
    // recorder. Both branches (tool-result continuation and fresh-turn
    // fallback) record — either can be the call that lands after a fold.
    const captured: any[][] = [];
    const Model = ruleModel()
      .onToolResult((_last, messages) => {
        captured.push([...messages]);
        return "answered";
      })
      .fallback((messages) => {
        captured.push([...messages]);
        return { toolCalls: [{ name: "lookup_order", args: { id: "1" } }] };
      })
      // Generously enqueue the same scripted summary so the summarizer
      // never runs dry across ~10 invokes' worth of possible folds.
      .structured(SUMMARY)
      .structured(SUMMARY)
      .structured(SUMMARY)
      .structured(SUMMARY)
      .structured(SUMMARY)
      .structured(SUMMARY)
      .structured(SUMMARY)
      .structured(SUMMARY)
      .structured(SUMMARY)
      .structured(SUMMARY)
      .structured(SUMMARY)
      .structured(SUMMARY)
      .structured(SUMMARY)
      .structured(SUMMARY)
      .structured(SUMMARY)
      .build();

    @LangGraphAgent({
      name: "summarizeE2eAgent",
      state: new StateSchema({ messages: MessagesValue }),
      model: CHAT,
      tools: [OrderTools],
      // Fold (CompactionMiddleware) writes the `summary` channel; view
      // (ContextWindowMiddleware) renders it into the prompt. Both are needed
      // to exercise the fold -> summary channel -> view render path end to end.
      middleware: [CompactionMiddleware, ContextWindowMiddleware],
    })
    class SummarizeE2eAgent {}

    harness = await createGraphTestingModule({
      graphs: [SummarizeE2eAgent],
      providers: [OrderTools, OrderService, { provide: CHAT, useClass: Model }],
      checkpointer: { type: "sqlite", path: ":memory:" },
      featureProviders: [
        // Same model token drives both the loop model and the summarizer —
        // the scripted model supports both roles (`.invoke` and
        // `.withStructuredOutput(...).invoke`).
        ...provideCompaction({
          triggerAt: { messages: 8 },
          keepRecent: 4,
          strategy: { kind: "summarize", model: CHAT },
        }),
        ...provideContextWindow({}),
      ],
    });
    const agent = harness.get(SummarizeE2eAgent);

    for (let i = 0; i < 10; i++) {
      const res: any = await agent.invoke(
        { messages: [new HumanMessage(`turn ${i}`)] },
        { configurable: { thread_id: "e2e-summarize" } },
      );
      // Head safety holds even under the summarize strategy: the fold only
      // ever cuts at HumanMessage boundaries.
      expect(res.messages[0]).toBeInstanceOf(HumanMessage);
    }

    // At least one captured call must have been rendered with a SystemMessage
    // carrying the scripted summary's `goal` text — proving the fold wrote the
    // `summary` channel AND the view rendered it into the prompt.
    const withSummary = captured.find((msgs) =>
      msgs.some(
        (m) =>
          m instanceof SystemMessage &&
          typeof m.content === "string" &&
          m.content.includes(SUMMARY.goal),
      ),
    );
    expect(withSummary).toBeDefined();
    expect(withSummary![0]).toBeInstanceOf(HumanMessage);
  });
});
