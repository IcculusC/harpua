import { Injectable, type InjectionToken, type Type } from "@nestjs/common";
import { ModuleRef } from "@nestjs/core";
import { SystemMessage } from "@langchain/core/messages";
import type { LangGraphMiddleware } from "../middleware/middleware.interface";
import type { ModelNext, ModelRequest } from "../middleware/middleware.types";

/**
 * A prompt source: called on EVERY model turn, so it can rebuild the prefix
 * from mutable state (a live skill menu, a registry). Rebuilding the prefix
 * resets prompt caching for the next turn — that cost is the caller's choice.
 */
export type SystemPromptSource = () => string | Promise<string>;

/** Config a `@LangGraphAgent` preset uses to lower its `systemPrompt`. */
export interface SystemPromptMiddlewareConfig {
  /**
   * The prompt text, a DI token resolving to the prompt string, or a source
   * function re-invoked every model turn. A CLASS is always treated as a DI
   * token; any other function (arrow or plain) is treated as a source.
   */
  systemPrompt: string | InjectionToken | SystemPromptSource;
}

/**
 * Lowers an agent's `systemPrompt` into a generated `wrapModelCall` middleware
 * (ordered OUTERMOST). It prepends a `SystemMessage` to the model request's
 * messages on every model turn — unless a `SystemMessage` already leads the
 * list, in which case NOTHING is prepended (a persisted leading
 * `SystemMessage` therefore pins the prompt: even a source form won't be
 * re-read for that request). A string prompt is baked in; a token prompt is
 * resolved from DI via `ModuleRef` at call time (a singleton provider
 * memoizes, so a token prompt is fixed after first resolution); a source
 * function is called fresh each turn.
 */
export function makeSystemPromptMiddleware(
  cfg: SystemPromptMiddlewareConfig,
): Type<LangGraphMiddleware> {
  const sp = cfg.systemPrompt;
  // Native classes have a non-writable `prototype`; arrow functions have none
  // and plain functions have a writable one. That is the line between "a DI
  // token that happens to be callable" and "a prompt source to invoke".
  const isSource =
    typeof sp === "function" &&
    Object.getOwnPropertyDescriptor(sp, "prototype")?.writable !== false;

  @Injectable()
  class SystemPromptMiddleware implements LangGraphMiddleware {
    constructor(private readonly moduleRef: ModuleRef) {}

    async wrapModelCall(req: ModelRequest<any>, next: ModelNext) {
      const leadsWithSystem = req.messages[0] instanceof SystemMessage;
      if (leadsWithSystem) return next(req);

      const text =
        typeof sp === "string"
          ? sp
          : isSource
            ? await (sp as SystemPromptSource)()
            : this.moduleRef.get<string>(sp as InjectionToken, { strict: false });

      return next({ ...req, messages: [new SystemMessage(text), ...req.messages] });
    }
  }
  return SystemPromptMiddleware;
}
