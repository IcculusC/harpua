import { Injectable, type Type } from "@nestjs/common";
import {
  AIMessage,
  ToolMessage,
  isHumanMessage,
  type BaseMessage,
  type UsageMetadata,
} from "@langchain/core/messages";
import {
  BaseChatModel,
  type BindToolsInput,
} from "@langchain/core/language_models/chat_models";
import type { BaseLanguageModelInput } from "@langchain/core/language_models/base";
import type { ChatResult } from "@langchain/core/outputs";
import { RunnableLambda, type Runnable } from "@langchain/core/runnables";
import { z } from "zod";

/**
 * A fake chat model produced by {@link scriptedModel}/{@link ruleModel}. It is a
 * genuine `BaseChatModel` — so it drops in anywhere LangChain expects a model
 * (vanilla LangGraph, our graphs, DI factories) and is driven with `.invoke()` —
 * plus a `reset()` to rewind per-instance script state between runs.
 */
export type FakeChatModel = BaseChatModel & { reset(): void };

/**
 * @deprecated The fakes now extend `BaseChatModel` (driven with `.invoke()`),
 * not a bespoke `respond()` surface. This alias for {@link FakeChatModel} exists
 * only so existing type annotations keep compiling; prefer `FakeChatModel` (or
 * `BaseChatModel`) directly.
 */
export type ScriptedChatModel = FakeChatModel;

/** Reads the text of a message, JSON-encoding non-string content. */
export function textOf(message: BaseMessage): string {
  return typeof message.content === "string"
    ? message.content
    : JSON.stringify(message.content);
}

/** A synthetic tool call the model can emit. `id` is auto-assigned if omitted. */
export const ToolCallSpec = z.object({
  name: z.string().min(1),
  args: z.record(z.string(), z.unknown()),
  id: z.string().min(1).optional(),
});
export type ToolCallSpec = z.infer<typeof ToolCallSpec>;

function toolCallMessage(
  calls: ToolCallSpec[],
  seq: number,
  content = "",
  additionalKwargs: Record<string, unknown> = {},
  usage?: UsageMetadata,
): AIMessage {
  const parsed = z.array(ToolCallSpec).min(1).parse(calls);
  return new AIMessage({
    content,
    additional_kwargs: additionalKwargs,
    tool_calls: parsed.map((call, index) => ({
      name: call.name,
      args: call.args,
      id: call.id ?? `call_${seq}_${index + 1}`,
      type: "tool_call",
    })),
    usage_metadata: usage,
  });
}

/* ------------------------------------------------------------------ */
/* BaseChatModel scaffold                                             */
/* ------------------------------------------------------------------ */

/**
 * Bridges scripted/rule behaviour onto the real `BaseChatModel` contract: the
 * abstract `respondTo` drives `_generate`, which mirrors `FakeListChatModel`'s
 * shape (`{ generations: [{ message, text }] }`). Emitting a plain `AIMessage`
 * with `tool_calls`/`additional_kwargs` here means `.invoke()` returns exactly
 * that message, so the agentic loop, tools, and interrupts all run for real.
 */
abstract class FakeChatModelBase extends BaseChatModel {
  /** Structured values enqueued by the builder's `.structured(...)`. */
  protected structuredQueue: unknown[] = [];
  /** Position in `structuredQueue`. Subclass `reset()` must zero this too. */
  protected structuredCursor = 0;

  constructor() {
    // No credentials/config — every param on BaseChatModelParams is optional.
    super({});
  }

  async _generate(messages: BaseMessage[]): Promise<ChatResult> {
    const message = this.respondTo(messages);
    return { generations: [{ message, text: textOf(message) }] };
  }

  /**
   * Tools are bound at the `ToolNode` level in our framework, so the model
   * itself only needs to accept `bindTools` without crashing. Matching
   * `FakeListChatModel`, this returns a bound runnable (here, itself).
   */
  bindTools(_tools: BindToolsInput[]): this {
    return this;
  }

  /**
   * Overrides `BaseChatModel.withStructuredOutput`'s real (6-overload)
   * signature with its simplest form: returns a `Runnable` that yields the
   * next value enqueued via the builder's `.structured(...)`, so
   * `responseFormat`-style consumers get a typed object back without a real
   * model call.
   */
  withStructuredOutput<RunOutput extends Record<string, any> = Record<string, any>>(
    _schema: unknown,
    _config?: unknown,
  ): Runnable<BaseLanguageModelInput, RunOutput> {
    return RunnableLambda.from(async (): Promise<RunOutput> => {
      const value = this.structuredQueue[this.structuredCursor];
      if (value === undefined) {
        throw new Error(
          "withStructuredOutput: no scripted structured value; enqueue one with " +
            ".structured(value) on the builder.",
        );
      }
      this.structuredCursor += 1;
      return value as RunOutput;
    });
  }

  /** Rewind any per-instance sequence state (no-op unless overridden). */
  reset(): void {}

  /** Produce the next assistant message for the running conversation. */
  protected abstract respondTo(messages: BaseMessage[]): AIMessage;
}

/* ------------------------------------------------------------------ */
/* Scripted (sequence) model                                          */
/* ------------------------------------------------------------------ */

type Turn = (seq: number) => AIMessage;

/**
 * Fluent builder for a deterministic model whose behaviour is a fixed SEQUENCE
 * of turns: the first `invoke()` yields turn 1, the next yields turn 2, and so
 * on. Ideal for a known agentic script — e.g. "request a tool, then summarize".
 */
export class ScriptedModelBuilder {
  private readonly turns: Turn[] = [];
  private readonly structuredValues: unknown[] = [];

  /** Emit a plain assistant message (optionally carrying `additional_kwargs` and `usage_metadata`). */
  say(
    text: string,
    options: { additionalKwargs?: Record<string, unknown>; usage?: UsageMetadata } = {},
  ): this {
    const additionalKwargs = options.additionalKwargs ?? {};
    this.turns.push(
      () => new AIMessage({
        content: text,
        additional_kwargs: additionalKwargs,
        usage_metadata: options.usage,
      }),
    );
    return this;
  }

  /** Emit an assistant message requesting a single tool. */
  toolCall(name: string, args: Record<string, unknown>, id?: string): this {
    return this.toolCalls([{ name, args, id }]);
  }

  /** Emit an assistant message requesting several tools in one turn. */
  toolCalls(calls: ToolCallSpec[]): this {
    this.turns.push((seq) => toolCallMessage(calls, seq));
    return this;
  }

  /** Emit a fully hand-built `AIMessage` for this turn. */
  emit(message: AIMessage): this {
    this.turns.push(() => message);
    return this;
  }

  /** Enqueue the next value `withStructuredOutput(...).invoke(...)` returns. */
  structured(value: unknown): this {
    this.structuredValues.push(value);
    return this;
  }

  /** Compile the script into an injectable `BaseChatModel` class. */
  build(): Type<FakeChatModel> {
    const turns = [...this.turns];
    const structuredValues = [...this.structuredValues];

    @Injectable()
    class ScriptedModel extends FakeChatModelBase {
      private cursor = 0;

      constructor() {
        super();
        this.structuredQueue = structuredValues;
      }

      _llmType(): string {
        return "harpua-scripted-fake";
      }

      protected respondTo(): AIMessage {
        const turn = turns[this.cursor];
        if (!turn) {
          throw new Error(
            `scriptedModel: ran out of scripted turns (${turns.length} declared, ` +
              `call ${this.cursor + 1} requested). Declare more turns, or use ` +
              `ruleModel() for open-ended conversations.`,
          );
        }
        const message = turn(this.cursor + 1);
        this.cursor += 1;
        return message;
      }

      reset(): void {
        this.cursor = 0;
        this.structuredCursor = 0;
      }
    }

    return ScriptedModel;
  }
}

/** Start a scripted (sequence) model. See {@link ScriptedModelBuilder}. */
export function scriptedModel(): ScriptedModelBuilder {
  return new ScriptedModelBuilder();
}

/* ------------------------------------------------------------------ */
/* Rule-based model                                                   */
/* ------------------------------------------------------------------ */

/**
 * What a rule returns. A bare string becomes a plain assistant message; an
 * `AIMessage` is passed through; the object form declares text and/or tool
 * calls plus optional `additional_kwargs` and `usage_metadata`.
 */
export type RuleResult =
  | string
  | AIMessage
  | {
      text?: string;
      toolCalls?: ToolCallSpec[];
      additionalKwargs?: Record<string, unknown>;
      usage?: UsageMetadata;
    };

function toAIMessage(result: RuleResult, seq: number): AIMessage {
  if (typeof result === "string") return new AIMessage(result);
  if (result instanceof AIMessage) return result;
  const additionalKwargs = result.additionalKwargs ?? {};
  if (result.toolCalls && result.toolCalls.length > 0) {
    return toolCallMessage(
      result.toolCalls,
      seq,
      result.text ?? "",
      additionalKwargs,
      result.usage,
    );
  }
  return new AIMessage({
    content: result.text ?? "",
    additional_kwargs: additionalKwargs,
    usage_metadata: result.usage,
  });
}

interface HumanRule {
  pattern: RegExp;
  respond: (text: string, match: RegExpExecArray) => RuleResult;
}

/**
 * Fluent builder for a rule-based model that matches on the latest turn — the
 * shape of `apps/api`'s `MockChatModel`. Rules are evaluated in order:
 * `onToolResult` first (when the last message is a `ToolMessage`), then each
 * `onHuman` regex against the latest human turn, then `fallback`.
 */
export class RuleModelBuilder {
  private toolResultRule?: (
    last: ToolMessage,
    messages: BaseMessage[],
  ) => RuleResult;
  private readonly humanRules: HumanRule[] = [];
  private fallbackRule: (messages: BaseMessage[]) => RuleResult = () => "";
  private readonly structuredValues: unknown[] = [];

  /** Enqueue the next value `withStructuredOutput(...).invoke(...)` returns. */
  structured(value: unknown): this {
    this.structuredValues.push(value);
    return this;
  }

  /** Respond when the latest message is a tool result. */
  onToolResult(
    respond: (last: ToolMessage, messages: BaseMessage[]) => RuleResult,
  ): this {
    this.toolResultRule = respond;
    return this;
  }

  /** Respond when the latest human turn matches `pattern` (first match wins). */
  onHuman(
    pattern: RegExp,
    respond:
      | RuleResult
      | ((text: string, match: RegExpExecArray) => RuleResult),
  ): this {
    const fn = typeof respond === "function" ? respond : () => respond;
    this.humanRules.push({ pattern, respond: fn });
    return this;
  }

  /** Respond when no other rule matched. */
  fallback(
    respond: RuleResult | ((messages: BaseMessage[]) => RuleResult),
  ): this {
    this.fallbackRule = typeof respond === "function" ? respond : () => respond;
    return this;
  }

  /** Compile the rules into an injectable `BaseChatModel` class. */
  build(): Type<FakeChatModel> {
    const toolResultRule = this.toolResultRule;
    const humanRules = [...this.humanRules];
    const fallbackRule = this.fallbackRule;
    const structuredValues = [...this.structuredValues];

    @Injectable()
    class RuleModel extends FakeChatModelBase {
      private seq = 0;

      constructor() {
        super();
        this.structuredQueue = structuredValues;
      }

      _llmType(): string {
        return "harpua-rule-fake";
      }

      protected respondTo(messages: BaseMessage[]): AIMessage {
        this.seq += 1;
        const last = messages[messages.length - 1];
        if (last instanceof ToolMessage && toolResultRule) {
          return toAIMessage(toolResultRule(last, messages), this.seq);
        }
        const lastHuman = [...messages].reverse().find((m) => isHumanMessage(m));
        const text = lastHuman ? textOf(lastHuman) : "";
        for (const rule of humanRules) {
          const match = rule.pattern.exec(text);
          if (match) return toAIMessage(rule.respond(text, match), this.seq);
        }
        return toAIMessage(fallbackRule(messages), this.seq);
      }

      reset(): void {
        this.seq = 0;
        this.structuredCursor = 0;
      }
    }

    return RuleModel;
  }
}

/** Start a rule-based model. See {@link RuleModelBuilder}. */
export function ruleModel(): RuleModelBuilder {
  return new RuleModelBuilder();
}
