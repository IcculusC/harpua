import { AIMessage, ToolMessage } from "@langchain/core/messages";
import {
  RetryMiddleware,
  RetryOptions,
  RETRY_OPTS,
  provideRetry,
} from "../middleware/retry.middleware";
import type { ModelRequest, ToolRequest } from "../middleware/middleware.types";

describe("RetryMiddleware", () => {
  it("retries model call and succeeds on third attempt", async () => {
    let callCount = 0;
    let backoffCallCount = 0;
    const backoffAttempts: number[] = [];

    const next = jest.fn(async () => {
      callCount++;
      if (callCount < 3) {
        throw new Error("Temporary failure");
      }
      return new AIMessage("Success");
    });

    const backoff = jest.fn(async (attempt: number) => {
      backoffCallCount++;
      backoffAttempts.push(attempt);
    });

    const opts: RetryOptions = {
      maxRetries: 3,
      retryable: () => true,
      backoff,
    };

    const mw = new RetryMiddleware(opts);
    const req: ModelRequest<any> = {
      messages: [],
      model: {} as any,
      state: {},
      withModel: (m) => ({ ...req, model: m }),
    };

    const result = await mw.wrapModelCall(req, next);

    expect(result).toEqual(new AIMessage("Success"));
    expect(next).toHaveBeenCalledTimes(3);
    expect(backoffCallCount).toBe(2);
    expect(backoffAttempts).toEqual([0, 1]);
  });

  it("rethrows non-retryable error immediately", async () => {
    let callCount = 0;

    const next = jest.fn(async () => {
      callCount++;
      throw new Error("Non-retryable error");
    });

    const backoff = jest.fn(async () => {});

    const opts: RetryOptions = {
      maxRetries: 3,
      retryable: () => false,
      backoff,
    };

    const mw = new RetryMiddleware(opts);
    const req: ModelRequest<any> = {
      messages: [],
      model: {} as any,
      state: {},
      withModel: (m) => ({ ...req, model: m }),
    };

    await expect(mw.wrapModelCall(req, next)).rejects.toThrow("Non-retryable error");
    expect(next).toHaveBeenCalledTimes(1);
    expect(backoff).not.toHaveBeenCalled();
  });

  it("rethrows after maxRetries exhausted", async () => {
    let callCount = 0;
    let backoffCallCount = 0;

    const next = jest.fn(async () => {
      callCount++;
      throw new Error("Persistent error");
    });

    const backoff = jest.fn(async () => {
      backoffCallCount++;
    });

    const opts: RetryOptions = {
      maxRetries: 2,
      retryable: () => true,
      backoff,
    };

    const mw = new RetryMiddleware(opts);
    const req: ModelRequest<any> = {
      messages: [],
      model: {} as any,
      state: {},
      withModel: (m) => ({ ...req, model: m }),
    };

    await expect(mw.wrapModelCall(req, next)).rejects.toThrow("Persistent error");
    expect(next).toHaveBeenCalledTimes(3); // initial + 2 retries
    expect(backoffCallCount).toBe(2);
  });

  it("retries tool call and succeeds on second attempt", async () => {
    let callCount = 0;
    let backoffCallCount = 0;

    const next = jest.fn(async () => {
      callCount++;
      if (callCount === 1) {
        throw new Error("Tool temporary error");
      }
      return new ToolMessage("Tool result");
    });

    const backoff = jest.fn(async () => {
      backoffCallCount++;
    });

    const opts: RetryOptions = {
      maxRetries: 1,
      retryable: () => true,
      backoff,
    };

    const mw = new RetryMiddleware(opts);
    const call: ToolRequest<any> = {
      name: "test-tool",
      args: { foo: "bar" },
      id: "call-1",
      state: {},
    };

    const result = await mw.wrapToolCall(call, next);

    expect(result).toEqual(new ToolMessage("Tool result"));
    expect(next).toHaveBeenCalledTimes(2);
    expect(backoffCallCount).toBe(1);
  });

  it("retryable predicate can inspect error", async () => {
    let callCount = 0;

    const next = jest.fn(async () => {
      callCount++;
      if (callCount === 1) {
        throw { code: "RETRYABLE" };
      }
      if (callCount === 2) {
        throw { code: "NON_RETRYABLE" };
      }
      return new AIMessage("Success");
    });

    const backoff = jest.fn(async () => {});

    const opts: RetryOptions = {
      maxRetries: 3,
      retryable: (err: any) => err?.code === "RETRYABLE",
      backoff,
    };

    const mw = new RetryMiddleware(opts);
    const req: ModelRequest<any> = {
      messages: [],
      model: {} as any,
      state: {},
      withModel: (m) => ({ ...req, model: m }),
    };

    await expect(mw.wrapModelCall(req, next)).rejects.toEqual({
      code: "NON_RETRYABLE",
    });
    expect(next).toHaveBeenCalledTimes(2);
    expect(backoff).toHaveBeenCalledTimes(1);
  });

  it("provideRetry returns correct provider array", () => {
    const opts: RetryOptions = {
      maxRetries: 2,
      retryable: () => true,
      backoff: async () => {},
    };

    const providers = provideRetry(opts);

    expect(providers).toHaveLength(2);
    expect(providers[0]).toEqual({
      provide: RETRY_OPTS,
      useValue: opts,
    });
    expect(providers[1]).toBe(RetryMiddleware);
  });

  it("provideRetry validates maxRetries is non-negative", () => {
    expect(() =>
      provideRetry({
        maxRetries: -1,
        retryable: () => true,
        backoff: async () => {},
      })
    ).toThrow();
  });

  it("provideRetry validates retryable is a function", () => {
    expect(() =>
      provideRetry({
        maxRetries: 2,
        retryable: "not a function" as any,
        backoff: async () => {},
      })
    ).toThrow();
  });

  it("provideRetry validates backoff is a function", () => {
    expect(() =>
      provideRetry({
        maxRetries: 2,
        retryable: () => true,
        backoff: "not a function" as any,
      })
    ).toThrow();
  });

  it("successful call on first attempt does not call backoff", async () => {
    const next = jest.fn(async () => new AIMessage("Immediate success"));
    const backoff = jest.fn(async () => {});

    const opts: RetryOptions = {
      maxRetries: 3,
      retryable: () => true,
      backoff,
    };

    const mw = new RetryMiddleware(opts);
    const req: ModelRequest<any> = {
      messages: [],
      model: {} as any,
      state: {},
      withModel: (m) => ({ ...req, model: m }),
    };

    const result = await mw.wrapModelCall(req, next);

    expect(result).toEqual(new AIMessage("Immediate success"));
    expect(next).toHaveBeenCalledTimes(1);
    expect(backoff).not.toHaveBeenCalled();
  });
});
