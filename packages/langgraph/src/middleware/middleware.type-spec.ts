/**
 * Type-level test for the middleware contract. Compiled by tsc (see
 * type-safety.spec.ts / tsconfig.type-test.json). A middleware literal using
 * every hook must typecheck against `LangGraphMiddleware`.
 */
import type {
  LangGraphMiddleware,
  MiddlewareContext,
  ModelRequest,
  ToolNext,
} from "./middleware.interface";

// A middleware using every hook must typecheck.
const _mw: LangGraphMiddleware<{ messages: unknown[] }> = {
  async beforeModel(ctx) {
    void ctx.loop.iteration;
    return ctx.exit({ reason: "x" });
  },
  async wrapModelCall(req, next) {
    return next(req.withModel(req.model));
  },
  async wrapToolCall(call, next: ToolNext) {
    return next(call);
  },
};
void _mw;

export {};
