import { Injectable, type InjectionToken, type Type } from "@nestjs/common";
import { ModuleRef } from "@nestjs/core";
import { SystemMessage } from "@langchain/core/messages";
import type { LangGraphMiddleware } from "../middleware/middleware.interface";
import type { ModelNext, ModelRequest } from "../middleware/middleware.types";

/** Config a `@LangGraphAgent` preset uses to lower its `systemPrompt`. */
export interface SystemPromptMiddlewareConfig {
  /** The prompt text, or a DI token resolving to the prompt string. */
  systemPrompt: string | InjectionToken;
}

/**
 * Lowers an agent's `systemPrompt` into a generated `wrapModelCall` middleware
 * (ordered OUTERMOST). It prepends a `SystemMessage` to the model request's
 * messages on every model turn — unless a `SystemMessage` already leads the
 * list — so the instruction reaches the model without fighting the append-only
 * `messages` reducer. A string prompt is baked in; a token prompt is resolved
 * from DI via `ModuleRef` at call time.
 */
export function makeSystemPromptMiddleware(
  cfg: SystemPromptMiddlewareConfig,
): Type<LangGraphMiddleware> {
  @Injectable()
  class SystemPromptMiddleware implements LangGraphMiddleware {
    constructor(private readonly moduleRef: ModuleRef) {}

    async wrapModelCall(req: ModelRequest<any>, next: ModelNext) {
      const text =
        typeof cfg.systemPrompt === "string"
          ? cfg.systemPrompt
          : this.moduleRef.get<string>(cfg.systemPrompt, { strict: false });

      const leadsWithSystem = req.messages[0] instanceof SystemMessage;
      const messages = leadsWithSystem
        ? req.messages
        : [new SystemMessage(text), ...req.messages];

      return next({ ...req, messages });
    }
  }
  return SystemPromptMiddleware;
}
