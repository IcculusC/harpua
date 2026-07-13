import { AIMessage } from "@langchain/core/messages";
import {
  ProviderGuardrailMiddleware,
  ProviderGuardrailOptions,
  provideProviderGuardrail,
  PROVIDER_GUARDRAIL_OPTS,
} from "../middleware/provider-guardrail.middleware";

/**
 * A provider-side block (finish_reason "content_filter" & co.) arrives as a
 * normal-looking assistant message carrying the provider's canned refusal.
 * Left alone it is checkpointed as the assistant's OWN words — the next turn
 * reads it back, concludes it refused, and redoes work that already
 * succeeded (field report 009). The guardrail swaps it for a note aimed at
 * the model's next turn BEFORE it enters history.
 */

function filteredReply(reason = "content_filter"): AIMessage {
  return new AIMessage({
    content: "我不能提供相关内容", // provider boilerplate, not the assistant's words
    id: "blocked-1",
    response_metadata: { finish_reason: reason, model_name: "deepseek/deepseek-v4-flash" },
    usage_metadata: { input_tokens: 5000, output_tokens: 0, total_tokens: 5000 },
  });
}

function cleanReply(): AIMessage {
  return new AIMessage({
    content: "here is the design",
    response_metadata: { finish_reason: "stop" },
  });
}

function mw(opts: unknown = {}): ProviderGuardrailMiddleware {
  return new ProviderGuardrailMiddleware(ProviderGuardrailOptions.parse(opts));
}

const req = { messages: [], model: {}, state: {}, withModel() { return this; } } as any;

describe("ProviderGuardrailMiddleware", () => {
  it("swaps a content_filter reply for a next-turn note before it enters history", async () => {
    const blocked = filteredReply();
    const out = await mw().wrapModelCall(req, async () => blocked);

    expect(out).not.toBe(blocked);
    const text = String(out.content);
    // The three load-bearing clauses, each answering an observed failure mode,
    // plus a machine-readable marker so clients can render it as a warning.
    expect(text).toContain("[[provider-guardrail:content_filter]]");
    expect(text).toMatch(/NOT a refusal/i);
    expect(text).toMatch(/DID succeed/i);
    expect(text).not.toContain("我不能提供相关内容");
    // The evidence survives on the persisted message.
    expect(out.response_metadata).toEqual(blocked.response_metadata);
    expect(out.usage_metadata).toEqual(blocked.usage_metadata);
    expect(out.id).toBe("blocked-1");
    expect(out.tool_calls ?? []).toHaveLength(0);
  });

  it("passes a clean reply through as the same instance", async () => {
    const clean = cleanReply();
    const out = await mw().wrapModelCall(req, async () => clean);
    expect(out).toBe(clean);
  });

  it("only neutralizes reasons listed in `on` (default: content_filter alone)", async () => {
    const refusal = filteredReply("refusal");
    // Not listed -> untouched.
    expect(await mw().wrapModelCall(req, async () => refusal)).toBe(refusal);
    // Listed -> neutralized, marker names the matched reason.
    const out = await mw({ on: ["content_filter", "refusal"] }).wrapModelCall(
      req,
      async () => refusal,
    );
    expect(String(out.content)).toContain("[[provider-guardrail:refusal]]");
  });

  it("retries: a guardrail hit is re-asked up to `retries` times and a clean rerouted reply wins", async () => {
    const replies = [filteredReply(), cleanReply()];
    let calls = 0;
    const next = async () => replies[calls++];
    const out = await mw({ retries: 1 }).wrapModelCall(req, next);
    expect(calls).toBe(2);
    expect(out).toBe(replies[1]);
  });

  it("retries exhausted on persistent blocks -> neutralizes, never exceeds retries+1 calls", async () => {
    let calls = 0;
    const next = async () => {
      calls++;
      return filteredReply();
    };
    const out = await mw({ retries: 1 }).wrapModelCall(req, next);
    expect(calls).toBe(2);
    expect(String(out.content)).toContain("[[provider-guardrail:content_filter]]");
  });

  it("defaults to zero retries: one call even on a hit", async () => {
    let calls = 0;
    const next = async () => {
      calls++;
      return filteredReply();
    };
    await mw().wrapModelCall(req, next);
    expect(calls).toBe(1);
  });

  it("a clean first reply with retries configured is NOT re-asked", async () => {
    // The inverse boundary: without this pin, a mutant that re-asks on every
    // turn (dropping the hit-check from the loop) doubles model spend silently.
    const clean = cleanReply();
    let calls = 0;
    const next = async () => {
      calls++;
      return clean;
    };
    const out = await mw({ retries: 3 }).wrapModelCall(req, next);
    expect(calls).toBe(1);
    expect(out).toBe(clean);
  });

  it("re-asks with a FRESH request copy so an inner in-place mutator can't compound across attempts", async () => {
    // An inner wrap middleware that rewrites req.messages in place (the
    // context-window assembler was one) would otherwise re-process its own
    // output on every retry — duplicate summary per attempt, reproduced in
    // review. Each attempt must start from the request as the guardrail
    // received it.
    const original = [new AIMessage("history")];
    const seenLengths: number[] = [];
    const innerMutator = async (attemptReq: any) => {
      seenLengths.push(attemptReq.messages.length);
      attemptReq.messages = [...attemptReq.messages, new AIMessage("summary")];
      return filteredReply();
    };
    const myReq = { messages: original, model: {}, state: {}, withModel() { return this; } } as any;
    await mw({ retries: 2 }).wrapModelCall(myReq, innerMutator);
    // Every attempt saw the pristine 1-message request…
    expect(seenLengths).toEqual([1, 1, 1]);
    // …and the guardrail's own caller sees its request untouched.
    expect(myReq.messages).toBe(original);
    expect(original).toHaveLength(1);
  });

  it("reasonOf lets non-OpenAI-shaped arms surface their reason key (e.g. Anthropic stop_reason)", async () => {
    const anthropicBlocked = new AIMessage({
      content: "blocked",
      response_metadata: { stop_reason: "refusal" },
    });
    const guard = mw({
      on: ["refusal"],
      reasonOf: (reply: AIMessage) => reply.response_metadata?.stop_reason,
    });
    const out = await guard.wrapModelCall(req, async () => anthropicBlocked);
    expect(String(out.content)).toContain("[[provider-guardrail:refusal]]");
    // Default extractor stays dead on that shape — the option is the bridge.
    const untouched = await mw({ on: ["refusal"] }).wrapModelCall(req, async () => anthropicBlocked);
    expect(untouched).toBe(anthropicBlocked);
  });

  it("the swap carries additional_kwargs (provider extras are evidence too)", async () => {
    const blocked = new AIMessage({
      content: "boilerplate",
      response_metadata: { finish_reason: "content_filter" },
      additional_kwargs: { moderation_id: "mod-7" },
    });
    const out = await mw().wrapModelCall(req, async () => blocked);
    expect(out.additional_kwargs).toEqual({ moderation_id: "mod-7" });
  });

  it("a custom note function receives the blocked reply", async () => {
    const out = await mw({
      note: (reply: AIMessage) => `blocked by ${reply.response_metadata?.model_name}`,
    }).wrapModelCall(req, async () => filteredReply());
    expect(out.content).toBe("blocked by deepseek/deepseek-v4-flash");
  });
});

describe("provideProviderGuardrail", () => {
  it("parses defaults and registers the options token + middleware", () => {
    const providers = provideProviderGuardrail();
    const optsProvider = providers[0] as { provide: unknown; useValue: any };
    expect(optsProvider.provide).toBe(PROVIDER_GUARDRAIL_OPTS);
    expect(optsProvider.useValue.on).toEqual(["content_filter"]);
    expect(optsProvider.useValue.retries).toBe(0);
    expect(providers[1]).toBe(ProviderGuardrailMiddleware);
  });

  it("rejects junk options at registration time", () => {
    expect(() => provideProviderGuardrail({ retries: -1 })).toThrow();
    expect(() => provideProviderGuardrail({ on: [] })).toThrow();
  });
});
