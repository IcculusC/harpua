import { AIMessage } from "@langchain/core/messages";
import { ManagedContextMiddleware, provideManagedContext } from "../middleware/managed-context.middleware";
import { CompactionMiddleware } from "../middleware/compaction.middleware";
import { ContextWindowMiddleware } from "../middleware/context-window.middleware";
import { COMPACTION_OPTS } from "../middleware/compaction.options";
import { CONTEXT_WINDOW_OPTS } from "../middleware/context-window.options";
import { COMPACTION_STATE } from "../middleware/compaction-state";

describe("ManagedContextMiddleware", () => {
  it("delegates each hook to the injected workers, forwarding args + returns", async () => {
    const compaction = { beforeModel: jest.fn(async () => ({ tag: "fold" })) } as any;
    const SENTINEL = new AIMessage("sentinel");
    const window = { wrapModelCall: jest.fn(async () => SENTINEL) } as any;
    const mw = new ManagedContextMiddleware(compaction, window);

    const ctxObj = {} as any;
    expect(await mw.beforeModel(ctxObj)).toEqual({ tag: "fold" });
    expect(compaction.beforeModel).toHaveBeenCalledWith(ctxObj);

    const req = { messages: [] } as any;
    const next = jest.fn();
    expect(await mw.wrapModelCall(req, next)).toBe(SENTINEL);
    expect(window.wrapModelCall).toHaveBeenCalledWith(req, next);
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
