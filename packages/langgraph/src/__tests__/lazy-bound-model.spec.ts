import { lazyBoundProxy } from "../lazy-bound-model";

// A stand-in "resolved model": records calls, offers a couple of Runnable-ish methods.
function fakeModel() {
  return {
    invoke: jest.fn(async (input: unknown) => `invoked:${String(input)}`),
    withStructuredOutput: jest.fn((_schema: unknown) => "structured-runnable"),
  };
}

describe("lazyBoundProxy", () => {
  it("does not call resolve on construction or on property access", () => {
    const resolve = jest.fn(fakeModel);
    const proxy = lazyBoundProxy(resolve as any);
    expect(resolve).toHaveBeenCalledTimes(0);
    // reading a method must NOT resolve — only calling it may
    const _read = (proxy as any).invoke;
    expect(resolve).toHaveBeenCalledTimes(0);
  });

  it("resolves on first call and delegates to the resolved model", async () => {
    const model = fakeModel();
    const resolve = jest.fn(() => model);
    const proxy = lazyBoundProxy(resolve as any);
    const out = await (proxy as any).invoke("hi");
    expect(out).toBe("invoked:hi");
    expect(resolve).toHaveBeenCalledTimes(1);
    expect(model.invoke).toHaveBeenCalledWith("hi");
  });

  it("memoizes success — a second call does not resolve again", async () => {
    const model = fakeModel();
    const resolve = jest.fn(() => model);
    const proxy = lazyBoundProxy(resolve as any);
    await (proxy as any).invoke("a");
    await (proxy as any).invoke("b");
    expect(resolve).toHaveBeenCalledTimes(1);
  });

  it("throws PER CALL when resolve throws — synchronously, and not memoized", () => {
    const resolve = jest.fn(() => {
      throw new Error("arm not registered");
    });
    const proxy = lazyBoundProxy(resolve as any);
    // SYNCHRONOUS throw (not a rejected promise): the wrapper is generic over
    // sync methods like withStructuredOutput too, and mirrors the eager factory.
    expect(() => (proxy as any).invoke("x")).toThrow("arm not registered");
    expect(() => (proxy as any).invoke("y")).toThrow("arm not registered");
    expect(resolve).toHaveBeenCalledTimes(2); // retried, not cached
  });

  it("is not thenable and does not resolve when awaited", async () => {
    const resolve = jest.fn(fakeModel);
    const proxy = lazyBoundProxy(resolve as any);
    expect((proxy as any).then).toBeUndefined();
    const awaited = await (proxy as any); // resolves to the proxy itself, not a hang
    expect(resolve).toHaveBeenCalledTimes(0);
    expect(awaited).toBe(proxy);
  });

  it("returns undefined for symbol keys", () => {
    const proxy = lazyBoundProxy((() => fakeModel()) as any);
    expect((proxy as any)[Symbol.iterator]).toBeUndefined();
    expect((proxy as any)[Symbol.toPrimitive]).toBeUndefined();
  });

  // Nest probes every provider for these hooks at bootstrap/shutdown and CALLS
  // any that are present. If the proxy returned a callable for them, Nest would
  // invoke it and resolve the arm at boot — the exact crash this feature kills.
  // They MUST stay undefined; dropping one silently reintroduces the boot crash.
  it("returns undefined for every Nest lifecycle-hook name (no boot-time resolution)", () => {
    const resolve = jest.fn(fakeModel);
    const proxy = lazyBoundProxy(resolve as any);
    for (const hook of [
      "onModuleInit",
      "onApplicationBootstrap",
      "onModuleDestroy",
      "beforeApplicationShutdown",
      "onApplicationShutdown",
    ]) {
      expect((proxy as any)[hook]).toBeUndefined();
    }
    expect(resolve).toHaveBeenCalledTimes(0);
  });

  it("delegates arbitrary Runnable methods (full-surface parity)", async () => {
    const model = fakeModel();
    const proxy = lazyBoundProxy((() => model) as any);
    const runnable = (proxy as any).withStructuredOutput({});
    expect(runnable).toBe("structured-runnable");
    expect(model.withStructuredOutput).toHaveBeenCalledTimes(1);
  });
});
