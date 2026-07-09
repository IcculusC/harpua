import { Inject, type Provider } from "@nestjs/common";
import { z } from "zod";
import { LangGraphMiddleware } from "../middleware/middleware.decorator";
import type { LangGraphMiddleware as LangGraphMiddlewareContract } from "../middleware/middleware.interface";
import type { MiddlewareContext } from "../middleware/middleware.types";
import { AGENT_LOOP_DEFAULT, AGENT_EXIT_DEFAULT } from "./loop-state";

export const BudgetOptions = z.object({
  maxCycles: z.number().int().positive(),
  maxToolCalls: z.number().int().positive(),
  maxTokens: z.number().int().positive(),
  maxWallMs: z.number().int().positive(),
  reset: z.enum(["invoke", "thread"]).default("invoke"),
});
export type BudgetOptions = z.infer<typeof BudgetOptions>;

export const BUDGET_OPTS = Symbol.for("@harpua/langgraph:BUDGET_OPTS");

/** Graceful loop guard: short-circuits to the agent's canonical exit when any
 *  budget (cycles/tool-calls/tokens/wall-time) is hit. The soft counterpart to
 *  LangGraph's hard recursionLimit throw. */
@LangGraphMiddleware()
export class BudgetMiddleware implements LangGraphMiddlewareContract {
  constructor(@Inject(BUDGET_OPTS) private readonly opts: BudgetOptions) {}

  /** Per-invoke reset: zero the loop counters + clear a stuck exit at START so
   *  a long-lived thread never accumulates into a permanent exit. */
  beforeAgent(_ctx: MiddlewareContext<any>): Partial<any> | void {
    if (this.opts.reset === "invoke") {
      return { loop: AGENT_LOOP_DEFAULT, exit: AGENT_EXIT_DEFAULT };
    }
  }

  async beforeModel(ctx: MiddlewareContext<any>): Promise<Partial<any> | void> {
    const { iteration, toolCalls, tokens, startedAt } = ctx.loop;
    // `startedAt` is anchored by `CallModelNode` on the FIRST model turn (and
    // by a `beforeAgent` hook earlier still, if the agent has one) — so from
    // the second `beforeModel` onward it holds a real clock reading and the
    // wall-time budget is live. The `startedAt > 0` guard only skips the
    // check on turn 1, before any model call has happened: wall-time can't
    // have been exceeded before the first model call anyway, and diffing
    // `ctx.now()` against the un-anchored `0` sentinel would otherwise read as
    // an already-astronomically-exceeded wall time and trip immediately.
    const wallExceeded = startedAt > 0 && ctx.now() - startedAt >= this.opts.maxWallMs;
    if (
      iteration >= this.opts.maxCycles ||
      toolCalls >= this.opts.maxToolCalls ||
      tokens >= this.opts.maxTokens ||
      wallExceeded
    ) {
      return ctx.exit({ reason: "budget" });
    }
  }
}

/** Providers for a Budget middleware with the given caps. */
export function provideBudget(opts: BudgetOptions): Provider[] {
  const parsed = BudgetOptions.parse(opts);
  return [{ provide: BUDGET_OPTS, useValue: parsed }, BudgetMiddleware];
}
