import { buildMiddlewareContext } from "../middleware/context";
import { makeHookNode } from "../agent/hook-node";
import { AGENT_LOOP_DEFAULT } from "../middleware/loop-state";

describe("buildMiddlewareContext", () => {
  it("now() returns the injected clock's value", () => {
    const ctx = buildMiddlewareContext({
      state: { messages: [] },
      config: {} as any,
      clock: () => 12345,
      exitTarget: "structured_response",
    });

    expect(ctx.now()).toBe(12345);
  });

  it("exit(meta) returns a state patch requesting exit with the meta attached", () => {
    const ctx = buildMiddlewareContext({
      state: { messages: [] },
      config: {} as any,
      clock: () => 0,
      exitTarget: "structured_response",
    });

    const result = ctx.exit({ reason: "budget" });

    expect(result).toEqual({
      exit: { requested: true, meta: { reason: "budget" } },
    });
  });

  it("exit() with no meta still requests exit, with meta undefined", () => {
    const ctx = buildMiddlewareContext({
      state: { messages: [] },
      config: {} as any,
      clock: () => 0,
      exitTarget: "END",
    });

    const result = ctx.exit();

    expect(result).toEqual({ exit: { requested: true, meta: undefined } });
  });

  it("loop falls back to AGENT_LOOP_DEFAULT when state has no loop", () => {
    const ctx = buildMiddlewareContext({
      state: { messages: [] },
      config: {} as any,
      clock: () => 0,
      exitTarget: "END",
    });

    expect(ctx.loop).toEqual(AGENT_LOOP_DEFAULT);
  });
});

describe("makeHookNode", () => {
  const CLOCK_TOKEN = "CLOCK_TOKEN";

  class RecordingBeforeModelMw {
    beforeModel(ctx: any) {
      return ctx.exit({ reason: "budget" });
    }
  }

  it("routes: beforeModel hook returning ctx.exit(...) returns the exit state patch directly", async () => {
    const middleware = new RecordingBeforeModelMw();
    const stubModuleRef = {
      get(token: unknown) {
        if (token === RecordingBeforeModelMw) return middleware;
        if (token === CLOCK_TOKEN) return () => 999;
        throw new Error(`unexpected token: ${String(token)}`);
      },
    };

    const HookNode = makeHookNode({
      hook: "beforeModel",
      middlewareClass: RecordingBeforeModelMw,
      exitTarget: "structured_response",
      clockToken: CLOCK_TOKEN,
    });
    const node = new HookNode(stubModuleRef as any);

    const result = await node.run(
      { loop: AGENT_LOOP_DEFAULT, messages: [] },
      {} as any,
    );

    expect(result).toEqual({
      exit: { requested: true, meta: { reason: "budget" } },
    });
  });

  class NoopBeforeAgentMw {
    beforeAgent() {
      return undefined;
    }
  }

  it("stamps loop.startedAt from the injected clock on beforeAgent when it was zero", async () => {
    const middleware = new NoopBeforeAgentMw();
    const stubModuleRef = {
      get(token: unknown) {
        if (token === NoopBeforeAgentMw) return middleware;
        if (token === CLOCK_TOKEN) return () => 5000;
        throw new Error(`unexpected token: ${String(token)}`);
      },
    };

    const HookNode = makeHookNode({
      hook: "beforeAgent",
      middlewareClass: NoopBeforeAgentMw,
      exitTarget: "END",
      clockToken: CLOCK_TOKEN,
    });
    const node = new HookNode(stubModuleRef as any);

    const result = await node.run({ loop: AGENT_LOOP_DEFAULT }, {} as any);

    expect(result.loop.startedAt).toBe(5000);
  });

  it("does not overwrite a non-zero startedAt on a subsequent beforeAgent run", async () => {
    const middleware = new NoopBeforeAgentMw();
    const stubModuleRef = {
      get(token: unknown) {
        if (token === NoopBeforeAgentMw) return middleware;
        if (token === CLOCK_TOKEN) return () => 5000;
        throw new Error(`unexpected token: ${String(token)}`);
      },
    };

    const HookNode = makeHookNode({
      hook: "beforeAgent",
      middlewareClass: NoopBeforeAgentMw,
      exitTarget: "END",
      clockToken: CLOCK_TOKEN,
    });
    const node = new HookNode(stubModuleRef as any);

    const result = await node.run(
      { loop: { ...AGENT_LOOP_DEFAULT, startedAt: 100 } },
      {} as any,
    );

    expect(result.loop.startedAt).toBe(100);
  });

  it("defaults the clock to Date.now() when no clockToken is configured", async () => {
    const middleware = new NoopBeforeAgentMw();
    const stubModuleRef = {
      get(token: unknown) {
        if (token === NoopBeforeAgentMw) return middleware;
        throw new Error(`unexpected token: ${String(token)}`);
      },
    };

    const HookNode = makeHookNode({
      hook: "beforeAgent",
      middlewareClass: NoopBeforeAgentMw,
      exitTarget: "END",
    });
    const node = new HookNode(stubModuleRef as any);

    const before = Date.now();
    const result = await node.run({ loop: AGENT_LOOP_DEFAULT }, {} as any);
    const after = Date.now();

    expect(result.loop.startedAt).toBeGreaterThanOrEqual(before);
    expect(result.loop.startedAt).toBeLessThanOrEqual(after);
  });

  class RecordingAfterModelMw {
    afterModel(ctx: any) {
      return { messages: [...(ctx.state.messages ?? []), "patched"] };
    }
  }

  it("afterModel returns the patch as-is (no loop stamping)", async () => {
    const middleware = new RecordingAfterModelMw();
    const stubModuleRef = {
      get(token: unknown) {
        if (token === RecordingAfterModelMw) return middleware;
        throw new Error(`unexpected token: ${String(token)}`);
      },
    };

    const HookNode = makeHookNode({
      hook: "afterModel",
      middlewareClass: RecordingAfterModelMw,
      exitTarget: "END",
    });
    const node = new HookNode(stubModuleRef as any);

    const result = await node.run(
      { loop: AGENT_LOOP_DEFAULT, messages: ["hi"] },
      {} as any,
    );

    expect(result).toEqual({ messages: ["hi", "patched"] });
  });
});
