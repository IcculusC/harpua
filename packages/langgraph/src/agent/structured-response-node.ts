import { Injectable, type InjectionToken, type Type } from "@nestjs/common";
import { ModuleRef } from "@nestjs/core";
import { SystemMessage, type BaseMessage } from "@langchain/core/messages";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import type { LangGraphRunnableConfig } from "@langchain/langgraph";
import { z } from "zod";
import type { NodeHandler } from "../interfaces";

export const ResponseFormatOptions = z.object({
  /** Route the envelope call to a different token (a smart arm, or a facade
   *  provider encoding any fallback policy — flash-first/pro-rescue, etc.).
   *  Default: the graph's bound model. This call sits OUTSIDE wrapModelCall
   *  by design, so a token here is the only routing seam it has. */
  model: z
    .custom<InjectionToken>(
      (v) =>
        typeof v === "string" || typeof v === "symbol" || typeof v === "function",
      "model must be an injection token (string, symbol, or class)",
    )
    .optional(),
  /** Re-ask on a thrown failure up to this many times before failing the
   *  turn. Default 0 (one shot). A parse failure or provider hang here lands
   *  AFTER every tool call already succeeded — intermittent provider
   *  roulette at the finish line is beaten by a retry, not a better prompt. */
  retries: z.number().int().nonnegative().default(0),
  /** Select the envelope call's input from the turn's messages (e.g. the
   *  pinned head + recent tail). Default: the full history — which at long
   *  contexts prices the envelope like a second full model call. */
  messages: z
    .custom<(messages: BaseMessage[]) => BaseMessage[]>((v) => typeof v === "function")
    .optional(),
  /** Replaces the default coercion system message. */
  instruction: z.string().min(1).optional(),
}).strict(); // a typoed key silently reverting an option to its default is the worst outcome
// INPUT type: `retries` has a `.default()`, callers pass options without it.
export type ResponseFormatOptions = z.input<typeof ResponseFormatOptions>;
export type ResolvedResponseFormatOptions = z.output<typeof ResponseFormatOptions>;

/** Config a `@LangGraphAgent` preset uses to generate its `StructuredResponseNode`. */
export interface StructuredResponseNodeConfig {
  /** DI token resolving the app's base (unbound) chat model. */
  modelToken: InjectionToken;
  /** Schema describing the desired structured `responseFormat`. */
  schema: unknown;
  /** Parsed `responseFormatOptions`; absent = all defaults (legacy behavior). */
  options?: ResolvedResponseFormatOptions;
}

/** Fixed instruction prepended so the model coerces its final answer to the schema. */
const COERCE_SYSTEM = new SystemMessage(
  "Return the final answer strictly as the requested structured object.",
);

/** What a `messages` selector must hand back. */
const SelectorResult = z.array(z.unknown());

/**
 * Builds the structured-response node a `@LangGraphAgent` preset generates
 * when `responseFormat` is configured: resolves the chat model (the graph's
 * base model, or `options.model` when routed), coerces it with
 * `withStructuredOutput(cfg.schema)`, and invokes it against the coercion
 * instruction plus the (optionally selected) state messages, re-asking up to
 * `options.retries` times on a thrown failure. Requires a structured-output-
 * capable model (the extended scripted/mock fakes implement
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
      const model = this.moduleRef.get<BaseChatModel>(
        cfg.options?.model ?? cfg.modelToken,
        { strict: false },
      );
      const history: BaseMessage[] = state.messages ?? [];
      let selected: BaseMessage[] = history;
      if (cfg.options?.messages) {
        // The selector gets a COPY — a sort/reverse/splice inside it must not
        // corrupt the state's messages channel behind the reducer's back —
        // and a nullish/non-array return fails loudly: silently falling back
        // to full history would reinstate the exact cost the option removes.
        const out = SelectorResult.safeParse(cfg.options.messages([...history]));
        if (!out.success) {
          throw new Error(
            "responseFormatOptions.messages must return an array of messages " +
              "(did the selector forget its return?)",
          );
        }
        selected = out.data as BaseMessage[];
      }
      const instruction = cfg.options?.instruction
        ? new SystemMessage(cfg.options.instruction)
        : COERCE_SYSTEM;
      const retries = cfg.options?.retries ?? 0;

      const structured = model.withStructuredOutput(cfg.schema as Record<string, any>);
      let lastError: unknown;
      for (let attempt = 0; attempt <= retries; attempt++) {
        try {
          const outcome = await structured.invoke([instruction, ...selected], config);
          return { outcome };
        } catch (err) {
          lastError = err;
        }
        // A dead request stays dead: re-asking with an aborted signal only
        // constructs doomed attempts and delays cancellation propagation.
        if ((config as { signal?: AbortSignal } | undefined)?.signal?.aborted) break;
      }
      throw lastError;
    }
  }
  return StructuredResponseNode;
}
