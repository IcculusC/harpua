import { Inject, type Provider } from "@nestjs/common";
import { z } from "zod";
import { LangGraphMiddleware } from "../middleware/middleware.decorator";
import type { LangGraphMiddleware as LangGraphMiddlewareContract } from "../middleware/middleware.interface";
import type { MiddlewareContext } from "../middleware/middleware.types";

export const BudgetOptions = z.object({
  maxCycles: z.number().int().positive(),
  maxToolCalls: z.number().int().positive(),
  maxTokens: z.number().int().positive(),
  maxWallMs: z.number().int().positive(),
});
export type BudgetOptions = z.infer<typeof BudgetOptions>;

export const BUDGET_OPTS = Symbol.for("@harpua/langgraph:BUDGET_OPTS");

/** Graceful loop guard: short-circuits to the agent's canonical exit when any
 *  budget (cycles/tool-calls/tokens/wall-time) is hit. The soft counterpart to
 *  LangGraph's hard recursionLimit throw. */
@LangGraphMiddleware()
export class BudgetMiddleware implements LangGraphMiddlewareContract {
  constructor(@Inject(BUDGET_OPTS) private readonly opts: BudgetOptions) {}

  async beforeModel(ctx: MiddlewareContext<any>): Promise<Partial<any> | void> {
    const { iteration, toolCalls, tokens, startedAt } = ctx.loop;
    if (
      iteration >= this.opts.maxCycles ||
      toolCalls >= this.opts.maxToolCalls ||
      tokens >= this.opts.maxTokens ||
      ctx.now() - startedAt >= this.opts.maxWallMs
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
