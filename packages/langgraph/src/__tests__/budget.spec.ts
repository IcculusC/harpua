import { z } from "zod";
import {
  BudgetMiddleware,
  BudgetOptions,
  BUDGET_OPTS,
  provideBudget,
} from "../middleware/budget.middleware";
import type { MiddlewareContext } from "../middleware/middleware.types";

describe("BudgetMiddleware", () => {
  it("returns exit patch when iteration cap is hit", async () => {
    const mw = new BudgetMiddleware({
      maxCycles: 3,
      maxToolCalls: 5,
      maxTokens: 100,
      maxWallMs: 1000,
    });

    const ctx: MiddlewareContext<any> = {
      state: {},
      loop: { iteration: 3, modelCalls: 0, toolCalls: 0, tokens: 0, startedAt: 0 },
      config: {},
      now: () => 500,
      interrupt: () => undefined,
      exit: (meta) => ({ exit: { requested: true, meta } }),
    };

    const result = await mw.beforeModel(ctx);

    expect(result).toEqual({ exit: { requested: true, meta: { reason: "budget" } } });
  });

  it("returns exit patch when toolCalls cap is hit", async () => {
    const mw = new BudgetMiddleware({
      maxCycles: 3,
      maxToolCalls: 5,
      maxTokens: 100,
      maxWallMs: 1000,
    });

    const ctx: MiddlewareContext<any> = {
      state: {},
      loop: { iteration: 0, modelCalls: 0, toolCalls: 5, tokens: 0, startedAt: 0 },
      config: {},
      now: () => 500,
      interrupt: () => undefined,
      exit: (meta) => ({ exit: { requested: true, meta } }),
    };

    const result = await mw.beforeModel(ctx);

    expect(result).toEqual({ exit: { requested: true, meta: { reason: "budget" } } });
  });

  it("returns exit patch when tokens cap is hit", async () => {
    const mw = new BudgetMiddleware({
      maxCycles: 3,
      maxToolCalls: 5,
      maxTokens: 100,
      maxWallMs: 1000,
    });

    const ctx: MiddlewareContext<any> = {
      state: {},
      loop: { iteration: 0, modelCalls: 0, toolCalls: 0, tokens: 100, startedAt: 0 },
      config: {},
      now: () => 500,
      interrupt: () => undefined,
      exit: (meta) => ({ exit: { requested: true, meta } }),
    };

    const result = await mw.beforeModel(ctx);

    expect(result).toEqual({ exit: { requested: true, meta: { reason: "budget" } } });
  });

  it("returns exit patch when wall-time cap is hit", async () => {
    const mw = new BudgetMiddleware({
      maxCycles: 3,
      maxToolCalls: 5,
      maxTokens: 100,
      maxWallMs: 1000,
    });

    const ctx: MiddlewareContext<any> = {
      state: {},
      loop: { iteration: 0, modelCalls: 0, toolCalls: 0, tokens: 0, startedAt: 0 },
      config: {},
      now: () => 1000,
      interrupt: () => undefined,
      exit: (meta) => ({ exit: { requested: true, meta } }),
    };

    const result = await mw.beforeModel(ctx);

    expect(result).toEqual({ exit: { requested: true, meta: { reason: "budget" } } });
  });

  it("returns undefined (falls through) when under all budget caps", async () => {
    const mw = new BudgetMiddleware({
      maxCycles: 3,
      maxToolCalls: 5,
      maxTokens: 100,
      maxWallMs: 1000,
    });

    const ctx: MiddlewareContext<any> = {
      state: {},
      loop: { iteration: 1, modelCalls: 0, toolCalls: 1, tokens: 10, startedAt: 0 },
      config: {},
      now: () => 500,
      interrupt: () => undefined,
      exit: (meta) => ({ exit: { requested: true, meta } }),
    };

    const result = await mw.beforeModel(ctx);

    expect(result).toBeUndefined();
  });

  it("provideBudget returns an array with the symbol provider and middleware class", () => {
    const opts: BudgetOptions = {
      maxCycles: 3,
      maxToolCalls: 5,
      maxTokens: 100,
      maxWallMs: 1000,
    };

    const providers = provideBudget(opts);

    expect(providers).toHaveLength(2);
    expect(providers[0]).toEqual({
      provide: BUDGET_OPTS,
      useValue: opts,
    });
    expect(providers[1]).toBe(BudgetMiddleware);
  });

  it("provideBudget validates options with zod and throws on invalid input", () => {
    const invalidOpts = {
      maxCycles: 0,
      maxToolCalls: 5,
      maxTokens: 100,
      maxWallMs: 1000,
    };

    expect(() => provideBudget(invalidOpts as any)).toThrow();
  });

  it("provideBudget throws when maxToolCalls is invalid", () => {
    const invalidOpts = {
      maxCycles: 3,
      maxToolCalls: -1,
      maxTokens: 100,
      maxWallMs: 1000,
    };

    expect(() => provideBudget(invalidOpts as any)).toThrow();
  });

  it("provideBudget throws when maxTokens is invalid", () => {
    const invalidOpts = {
      maxCycles: 3,
      maxToolCalls: 5,
      maxTokens: 0,
      maxWallMs: 1000,
    };

    expect(() => provideBudget(invalidOpts as any)).toThrow();
  });

  it("provideBudget throws when maxWallMs is invalid", () => {
    const invalidOpts = {
      maxCycles: 3,
      maxToolCalls: 5,
      maxTokens: 100,
      maxWallMs: 0,
    };

    expect(() => provideBudget(invalidOpts as any)).toThrow();
  });
});
