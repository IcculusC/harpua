import { Injectable, type InjectionToken, type Type } from "@nestjs/common";
import { ModuleRef } from "@nestjs/core";
import { SystemMessage } from "@langchain/core/messages";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import type { LangGraphRunnableConfig } from "@langchain/langgraph";
import type { NodeHandler } from "../interfaces";

/** Config a `@LangGraphAgent` preset uses to generate its `StructuredResponseNode`. */
export interface StructuredResponseNodeConfig {
  /** DI token resolving the app's base (unbound) chat model. */
  modelToken: InjectionToken;
  /** Schema describing the desired structured `responseFormat`. */
  schema: unknown;
}

/** Fixed instruction prepended so the model coerces its final answer to the schema. */
const COERCE_SYSTEM = new SystemMessage(
  "Return the final answer strictly as the requested structured object.",
);

/**
 * Builds the structured-response node a `@LangGraphAgent` preset generates
 * when `responseFormat` is configured: resolves the app's base chat model via
 * `ModuleRef`, coerces it with `withStructuredOutput(cfg.schema)`, and invokes
 * it against the coercion instruction plus the state's messages. Requires a
 * structured-output-capable model (the extended scripted/mock fakes implement
 * `withStructuredOutput`, so this also works in mock mode).
 */
export function makeStructuredResponseNode(
  cfg: StructuredResponseNodeConfig,
): Type<NodeHandler<any>> {
  @Injectable()
  class StructuredResponseNode implements NodeHandler<any> {
    constructor(private readonly moduleRef: ModuleRef) {}

    async run(
      state: any,
      config?: LangGraphRunnableConfig,
    ): Promise<Partial<any>> {
      const model = this.moduleRef.get<BaseChatModel>(cfg.modelToken, {
        strict: false,
      });
      const messages = state.messages ?? [];
      const outcome = await model
        .withStructuredOutput(cfg.schema as Record<string, any>)
        .invoke([COERCE_SYSTEM, ...messages], config);

      return { outcome };
    }
  }
  return StructuredResponseNode;
}
