import { AIMessage } from "@langchain/core/messages";
import { ManagedContextMiddleware, provideManagedContext } from "../middleware/managed-context.middleware";
import { CompactionMiddleware } from "../middleware/compaction.middleware";
import { ContextWindowMiddleware } from "../middleware/context-window.middleware";
import { COMPACTION_OPTS } from "../middleware/compaction.options";
import { CONTEXT_WINDOW_OPTS } from "../middleware/context-window.options";
import { COMPACTION_STATE } from "../middleware/compaction-state";

describe("ManagedContextMiddleware", () => {
  it("delegates each hook to the injected workers", async () => {
    const compaction = { beforeModel: jest.fn(async () => ({ tag: "fold" })) } as any;
    const window = { wrapModelCall: jest.fn(async (_r: any, n: any) => n(_r)) } as any;
    const mw = new ManagedContextMiddleware(compaction, window);
    await mw.beforeModel({} as any);
    expect(compaction.beforeModel).toHaveBeenCalled();
    const next = jest.fn(async () => new AIMessage("x"));
    await mw.wrapModelCall({ messages: [] } as any, next);
    expect(window.wrapModelCall).toHaveBeenCalled();
  });

  it("carries the compaction-state marker", () => {
    expect((ManagedContextMiddleware as any)[COMPACTION_STATE]).toBe(true);
  });

  it("provideManagedContext wires both option tokens + all three classes", () => {
    const providers = provideManagedContext({ triggerAt: { messages: 40 }, keepRecent: 20 });
    const provided = providers.map((p: any) => (p.provide ? p.provide : p));
    expect(provided).toContain(COMPACTION_OPTS);
    expect(provided).toContain(CONTEXT_WINDOW_OPTS);
    expect(provided).toContain(CompactionMiddleware);
    expect(provided).toContain(ContextWindowMiddleware);
    expect(provided).toContain(ManagedContextMiddleware);
  });
});
