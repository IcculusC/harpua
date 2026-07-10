import { BudgetMiddleware, BudgetOptions } from "../middleware/budget.middleware";
import { clearAgentExit } from "../middleware/clear-exit";
import { AGENT_LOOP_DEFAULT, AGENT_EXIT_DEFAULT } from "../middleware/loop-state";

function ctx(loop: any) {
  return { state: {}, loop, config: {}, now: () => 0, interrupt: () => undefined, exit: (meta: any) => ({ exit: { requested: true, meta } }) } as any;
}

describe("Budget per-invoke reset", () => {
  it("defaults reset to 'invoke'", () => {
    expect(BudgetOptions.parse({ maxCycles: 1, maxToolCalls: 1, maxTokens: 1, maxWallMs: 1 }).reset).toBe("invoke");
  });

  it("beforeAgent clears loop + exit when reset='invoke'", async () => {
    const mw = new BudgetMiddleware(BudgetOptions.parse({ maxCycles: 5, maxToolCalls: 5, maxTokens: 5, maxWallMs: 5, reset: "invoke" }));
    const patch: any = await mw.beforeAgent(ctx({ ...AGENT_LOOP_DEFAULT, iteration: 9 }));
    expect(patch).toEqual({ loop: AGENT_LOOP_DEFAULT, exit: AGENT_EXIT_DEFAULT });
  });

  it("beforeAgent is a no-op when reset='thread'", async () => {
    const mw = new BudgetMiddleware(BudgetOptions.parse({ maxCycles: 5, maxToolCalls: 5, maxTokens: 5, maxWallMs: 5, reset: "thread" }));
    expect(await mw.beforeAgent(ctx(AGENT_LOOP_DEFAULT))).toBeUndefined();
  });

  it("clearAgentExit produces a reset-exit patch", () => {
    expect(clearAgentExit()).toEqual({ exit: AGENT_EXIT_DEFAULT });
  });
});
