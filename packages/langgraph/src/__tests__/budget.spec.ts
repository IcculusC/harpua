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

    // `startedAt: 0` is the un-anchored sentinel (see beforeModel's doc
    // comment) -- a real "loop started" stamp is always a positive clock
    // reading, so this uses one to exercise the genuine wall-time-exceeded
    // path rather than the "not yet anchored" skip.
    const ctx: MiddlewareContext<any> = {
      state: {},
      loop: { iteration: 0, modelCalls: 0, toolCalls: 0, tokens: 0, startedAt: 500 },
      config: {},
      now: () => 1500,
      interrupt: () => undefined,
      exit: (meta) => ({ exit: { requested: true, meta } }),
    };

    const result = await mw.beforeModel(ctx);

    expect(result).toEqual({ exit: { requested: true, meta: { reason: "budget" } } });
  });

  it("does not trip the wall-time budget while startedAt is still the un-anchored 0 sentinel", async () => {
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
      // A real epoch-millis clock reading dwarfs any sane maxWallMs; if `0`
      // were treated as a real start time this would false-positive trip.
      now: () => 1_700_000_000_000,
      interrupt: () => undefined,
      exit: (meta) => ({ exit: { requested: true, meta } }),
    };

    const result = await mw.beforeModel(ctx);

    expect(result).toBeUndefined();
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

  it("falls through when iteration is one below the cap", async () => {
    const mw = new BudgetMiddleware({
      maxCycles: 3,
      maxToolCalls: 5,
      maxTokens: 100,
      maxWallMs: 1000,
    });

    const ctx: MiddlewareContext<any> = {
      state: {},
      loop: { iteration: 2, modelCalls: 0, toolCalls: 0, tokens: 0, startedAt: 0 },
      config: {},
      now: () => 1,
      interrupt: () => undefined,
      exit: (meta) => ({ exit: { requested: true, meta } }),
    };

    const result = await mw.beforeModel(ctx);

    expect(result).toBeUndefined();
  });

  it("falls through when toolCalls is one below the cap", async () => {
    const mw = new BudgetMiddleware({
      maxCycles: 3,
      maxToolCalls: 5,
      maxTokens: 100,
      maxWallMs: 1000,
    });

    const ctx: MiddlewareContext<any> = {
      state: {},
      loop: { iteration: 0, modelCalls: 0, toolCalls: 4, tokens: 0, startedAt: 0 },
      config: {},
      now: () => 1,
      interrupt: () => undefined,
      exit: (meta) => ({ exit: { requested: true, meta } }),
    };

    const result = await mw.beforeModel(ctx);

    expect(result).toBeUndefined();
  });

  it("falls through when tokens is one below the cap", async () => {
    const mw = new BudgetMiddleware({
      maxCycles: 3,
      maxToolCalls: 5,
      maxTokens: 100,
      maxWallMs: 1000,
    });

    const ctx: MiddlewareContext<any> = {
      state: {},
      loop: { iteration: 0, modelCalls: 0, toolCalls: 0, tokens: 99, startedAt: 0 },
      config: {},
      now: () => 1,
      interrupt: () => undefined,
      exit: (meta) => ({ exit: { requested: true, meta } }),
    };

    const result = await mw.beforeModel(ctx);

    expect(result).toBeUndefined();
  });

  it("falls through when wall-time is one below the cap", async () => {
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
      now: () => 999,
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
