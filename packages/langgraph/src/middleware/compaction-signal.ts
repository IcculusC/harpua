import { isAIMessage, type BaseMessage } from "@langchain/core/messages";
import type { MiddlewareContext } from "./middleware.types";
import type { LoopInfo } from "./loop-state";
import type { TriggerSpec } from "./compaction.options";

export interface CompactionSignal<S = any> {
  inputTokens: number | null;
  messageCount: number;
  messages: BaseMessage[];
  loop: LoopInfo;
  ctx: MiddlewareContext<S>;
}

/** Build the trigger signal from a node-hook context. */
export function buildCompactionSignal<S>(ctx: MiddlewareContext<S>): CompactionSignal<S> {
  const messages: BaseMessage[] = ((ctx.state as any)?.messages ?? []) as BaseMessage[];
  let last: any;
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m && isAIMessage(m)) {
      last = m;
      break;
    }
  }
  const inputTokens =
    typeof last?.usage_metadata?.input_tokens === "number"
      ? last.usage_metadata.input_tokens
      : null;
  return { inputTokens, messageCount: messages.length, messages, loop: ctx.loop, ctx };
}

/** Desugar a TriggerSpec into a predicate over the signal. */
export function resolveTrigger(spec: TriggerSpec): (s: CompactionSignal) => boolean {
  if (typeof spec === "function") return spec;
  if ("tokens" in spec) return (s) => (s.inputTokens ?? 0) >= spec.tokens;
  return (s) => s.messageCount >= spec.messages;
}
