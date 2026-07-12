import { isAIMessage, type BaseMessage } from "@langchain/core/messages";
import { z } from "zod";
import type { MiddlewareContext } from "./middleware.types";
import type { LoopInfo } from "./loop-state";
import type { TriggerSpec } from "./compaction.options";

const TokenCount = z.number().int().nonnegative();

/** zod-validated read of one candidate count; any junk reads as absent. */
function count(v: unknown): number | undefined {
  const parsed = TokenCount.safeParse(v);
  return parsed.success ? parsed.data : undefined;
}

/**
 * Every shape a provider is known to report input-token counts in, tried in
 * order — `usage_metadata` (canonical) first. Some provider/version combos
 * surface usage ONLY via `response_metadata` (e.g. OpenRouter streaming
 * persisting `tokenUsage` while `usage_metadata` is lost upstream — field
 * report, issue #61), so reading `usage_metadata` alone leaves a
 * `{ tokens: N }` trigger silently dead as context grows. Each candidate is
 * validated independently, so one junk-typed count falls through to the
 * next instead of killing the read.
 */
function readInputTokens(last: unknown): number | null {
  const m = last as {
    usage_metadata?: { input_tokens?: unknown };
    response_metadata?: {
      tokenUsage?: { prompt_tokens?: unknown; promptTokens?: unknown };
      usage?: { input_tokens?: unknown; prompt_tokens?: unknown };
    };
  } | null | undefined;
  return (
    count(m?.usage_metadata?.input_tokens) ??
    count(m?.response_metadata?.tokenUsage?.prompt_tokens) ??
    count(m?.response_metadata?.tokenUsage?.promptTokens) ??
    count(m?.response_metadata?.usage?.input_tokens) ??
    count(m?.response_metadata?.usage?.prompt_tokens) ??
    null
  );
}

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
  return {
    inputTokens: readInputTokens(last),
    messageCount: messages.length,
    messages,
    loop: ctx.loop,
    ctx,
  };
}

/** Desugar a TriggerSpec into a predicate over the signal. */
export function resolveTrigger(spec: TriggerSpec): (s: CompactionSignal) => boolean {
  if (typeof spec === "function") return spec;
  if ("tokens" in spec) return (s) => (s.inputTokens ?? 0) >= spec.tokens;
  return (s) => s.messageCount >= spec.messages;
}
