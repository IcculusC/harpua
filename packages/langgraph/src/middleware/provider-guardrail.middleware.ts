import { Inject, type Provider } from "@nestjs/common";
import { z } from "zod";
import { AIMessage } from "@langchain/core/messages";
import { LangGraphMiddleware } from "../middleware/middleware.decorator";
import type { LangGraphMiddleware as LangGraphMiddlewareContract } from "../middleware/middleware.interface";
import type { ModelRequest, ModelNext } from "../middleware/middleware.types";

export const ProviderGuardrailOptions = z.object({
  /** Terminal finish_reasons that mark a provider-side intervention whose
   *  "reply" is provider boilerplate, not model output. */
  on: z.array(z.string().min(1)).nonempty().default(["content_filter"]),
  /** Re-ask `next` up to this many times while the reply is a guardrail hit
   *  before neutralizing — worth 1 on multi-upstream routers (OpenRouter
   *  re-routes stochastically, so a second ask often lands on an upstream
   *  with a different filter policy). Default 0: never spend unasked. */
  retries: z.number().int().nonnegative().default(0),
  /** Replacement text for a neutralized reply; receives the blocked message.
   *  Defaults to wording aimed at the model's NEXT turn (see the note). */
  note: z
    .custom<(reply: AIMessage) => string>((v) => typeof v === "function")
    .optional(),
  /** Where the provider surfaces its terminal reason. Defaults to the
   *  OpenAI-compatible `response_metadata.finish_reason` (OpenRouter, Azure,
   *  openai-compatible arms). Google puts it at `finishReason`, Anthropic at
   *  `stop_reason` — without this bridge the guardrail is silently dead on
   *  those shapes, which is this middleware's own failure class. */
  reasonOf: z
    .custom<(reply: AIMessage) => unknown>((v) => typeof v === "function")
    .optional(),
});
// INPUT type (not `z.infer`): `on`/`retries` carry `.default(...)`, so the
// output type would make them required — callers pass options without them.
export type ProviderGuardrailOptions = z.input<typeof ProviderGuardrailOptions>;

export const PROVIDER_GUARDRAIL_OPTS = Symbol.for(
  "@harpua/langgraph:PROVIDER_GUARDRAIL_OPTS",
);

const FinishReason = z.string().min(1);

/**
 * Every clause is aimed at the model's next turn and answers an observed
 * failure mode: without "before the model ran" it reads the note as its own
 * reasoning; without "NOT a refusal" it concludes it declined; without
 * "tool calls DID succeed" it redoes work that already completed. The
 * `[[provider-guardrail:<reason>]]` marker lets a client render the note as
 * a warning instead of assistant speech.
 */
function defaultNote(reason: string): string {
  return (
    `[[provider-guardrail:${reason}]] The provider blocked this completion ` +
    `before the model ran (finish_reason: "${reason}"; no tokens were ` +
    `generated). This is NOT a refusal by the assistant or the user — the ` +
    `provider's boilerplate was replaced with this note. Any tool calls made ` +
    `before this point DID succeed; do not redo them. Continue the task, ` +
    `rephrasing the previous request if needed.`
  );
}

/** The matched guardrail reason, or null for a genuine model reply. */
function hitReason(
  reply: AIMessage,
  on: readonly string[],
  reasonOf?: (reply: AIMessage) => unknown,
): string | null {
  const raw = reasonOf
    ? reasonOf(reply)
    : reply.response_metadata?.finish_reason;
  const parsed = FinishReason.safeParse(raw);
  if (!parsed.success) return null;
  return on.includes(parsed.data) ? parsed.data : null;
}

/**
 * Neutralizes provider-side blocks before they poison history: a guardrail
 * hit (e.g. `finish_reason: "content_filter"`) arrives as a normal-looking
 * assistant message carrying the provider's canned refusal — checkpointed
 * as-is, the next turn reads it back as the assistant's OWN words, concludes
 * it refused, and redoes work that already succeeded. The swap replaces the
 * boilerplate with a note written for the model's next turn while keeping
 * the evidence (`response_metadata`, zero-token usage, id) on the message.
 */
@LangGraphMiddleware()
export class ProviderGuardrailMiddleware implements LangGraphMiddlewareContract {
  constructor(
    @Inject(PROVIDER_GUARDRAIL_OPTS)
    private readonly opts: ProviderGuardrailOptions,
  ) {}

  async wrapModelCall(req: ModelRequest<any>, next: ModelNext): Promise<AIMessage> {
    // Raw-constructed instances may skip `provideProviderGuardrail`'s parse,
    // so re-apply the defaults here (same convention as BudgetMiddleware).
    const on = this.opts.on ?? ["content_filter"];
    const retries = this.opts.retries ?? 0;
    const reasonOf = this.opts.reasonOf;

    // Every attempt gets a FRESH shallow copy: an inner wrap middleware that
    // rewrites request fields in place would otherwise re-process its own
    // output on the re-ask (a write-back in the context-window assembler
    // duplicated the summary per retry), and the guardrail's own caller must
    // never observe inner mutations either.
    let reply = await next({ ...req });
    for (
      let attempt = 0;
      attempt < retries && hitReason(reply, on, reasonOf) != null;
      attempt++
    ) {
      reply = await next({ ...req });
    }

    const reason = hitReason(reply, on, reasonOf);
    if (reason == null) return reply;

    return new AIMessage({
      content: this.opts.note?.(reply) ?? defaultNote(reason),
      // Keep the evidence: finish_reason, provider extras, and the
      // zero-token usage stay readable on the persisted message. No
      // tool_calls — a swapped reply must never leave the loop router
      // waiting on phantom tool results.
      response_metadata: reply.response_metadata,
      additional_kwargs: reply.additional_kwargs,
      usage_metadata: reply.usage_metadata,
      id: reply.id,
    });
  }
}

/** Providers for a ProviderGuardrail middleware with the given policy. */
export function provideProviderGuardrail(
  opts: ProviderGuardrailOptions = {},
): Provider[] {
  const parsed = ProviderGuardrailOptions.parse(opts);
  return [
    { provide: PROVIDER_GUARDRAIL_OPTS, useValue: parsed },
    ProviderGuardrailMiddleware,
  ];
}
