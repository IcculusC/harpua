import { StateSchema, MessagesValue } from "@langchain/langgraph";
import { HumanMessage } from "@langchain/core/messages";
import { LangGraphAgent, ManagedContextMiddleware, provideManagedContext } from "@harpua/langgraph";
import { createGraphTestingModule, type GraphTestingHarness } from "../testing-module";
import { ruleModel } from "../scripted-model";

/** Serialize the prefix up to (and including) the last cache boundary. */
function prefixSignature(messages: any[]): string {
  return JSON.stringify(
    messages.map((m) => [
      m._getType?.() ?? "?",
      typeof m.content === "string" ? m.content : JSON.stringify(m.content),
    ]),
  );
}

describe("compaction prefix stability", () => {
  let harness: GraphTestingHarness;
  afterEach(async () => {
    await harness?.close();
  });

  it("keeps the rendered prefix byte-stable across append-only turns", async () => {
    const CHAT = Symbol.for("cps:model");
    const captured: any[][] = [];
    // A rule model that records exactly what it was asked to answer (the assembled view).
    const Recorder = ruleModel()
      .fallback((messages) => {
        captured.push([...messages]);
        return "ok";
      })
      .build();

    @LangGraphAgent({
      name: "cpsAgent",
      state: new StateSchema({ messages: MessagesValue }),
      model: CHAT,
      middleware: [ManagedContextMiddleware],
    })
    class CpsAgent {}

    harness = await createGraphTestingModule({
      graphs: [CpsAgent],
      providers: [{ provide: CHAT, useClass: Recorder }],
      // ManagedContextMiddleware's option tokens must live in forFeature's scope.
      featureProviders: provideManagedContext({ triggerAt: { messages: 999 }, keepRecent: 4 }), // never folds here
    });
    const agent = harness.get(CpsAgent);

    // Two appends on one thread; no fold (trigger set absurdly high).
    await agent.invoke({ messages: [new HumanMessage("one")] }, { configurable: { thread_id: "cps" } });
    await agent.invoke({ messages: [new HumanMessage("two")] }, { configurable: { thread_id: "cps" } });

    // Guard against a degenerate single-capture tautology: if the second model
    // call never happened (harness change, response caching, short-circuit bug),
    // captured[0] === captured[last] and the comparison below becomes x === x.
    expect(captured.length).toBe(2);

    // The first call's rendered messages must be a prefix of the second call's.
    const first = prefixSignature(captured[0]);
    const secondPrefix = prefixSignature(captured[captured.length - 1].slice(0, captured[0].length));
    expect(secondPrefix).toBe(first);
  });
});
