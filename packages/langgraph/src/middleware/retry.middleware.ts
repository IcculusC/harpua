import { Inject, type Provider } from "@nestjs/common";
import { z } from "zod";
import type { AIMessage, ToolMessage } from "@langchain/core/messages";
import { LangGraphMiddleware } from "../middleware/middleware.decorator";
import type { LangGraphMiddleware as LangGraphMiddlewareContract } from "../middleware/middleware.interface";
import type { ModelRequest, ModelNext, ToolRequest, ToolNext } from "../middleware/middleware.types";

export const RetryOptions = z.object({
  maxRetries: z.number().int().nonnegative(),
  retryable: z.custom<(e: unknown) => boolean>((v) => typeof v === "function"),
  backoff: z.custom<(attempt: number) => Promise<void>>((v) => typeof v === "function"),
});
export type RetryOptions = z.infer<typeof RetryOptions>;

export const RETRY_OPTS = Symbol.for("@harpua/langgraph:RETRY_OPTS");

/** Retries model AND tool calls (one middleware, both callable-wraps, shared
 *  backoff). `next` is re-invoked up to `maxRetries` times while `retryable(err)`
 *  holds; `backoff(attempt)` is awaited between attempts (injectable for tests). */
@LangGraphMiddleware()
export class RetryMiddleware implements LangGraphMiddlewareContract {
  constructor(@Inject(RETRY_OPTS) private readonly opts: RetryOptions) {}

  wrapModelCall(req: ModelRequest<any>, next: ModelNext): Promise<AIMessage> {
    return this.withRetry(() => next(req));
  }
  wrapToolCall(call: ToolRequest<any>, next: ToolNext): Promise<ToolMessage> {
    return this.withRetry(() => next(call));
  }

  private async withRetry<T>(op: () => Promise<T>): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      try {
        return await op();
      } catch (err) {
        if (attempt >= this.opts.maxRetries || !this.opts.retryable(err)) throw err;
        await this.opts.backoff(attempt);
      }
    }
  }
}

/** Providers for a Retry middleware with the given policy. */
export function provideRetry(opts: RetryOptions): Provider[] {
  const parsed = RetryOptions.parse(opts);
  return [{ provide: RETRY_OPTS, useValue: parsed }, RetryMiddleware];
}
