import { Injectable, type Type } from "@nestjs/common";
import {
  AIMessage,
  ToolMessage,
  isHumanMessage,
  type BaseMessage,
} from "@langchain/core/messages";
import { z } from "zod";

/**
 * The shape a scripted/rule model exposes: it inspects the running conversation
 * and returns the next `AIMessage`. This is the exact surface a `CallModel`-style
 * node consumes (`this.model.respond(state.messages)`), so a scripted model drops
 * in wherever a real chat model would — as an ordinary injectable, no network.
 */
export interface ScriptedChatModel {
  respond(messages: BaseMessage[]): AIMessage;
  /** Rewind a sequence model back to its first turn (no-op for rule models). */
  reset?(): void;
}

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
  });
}

/* ------------------------------------------------------------------ */
/* Scripted (sequence) model                                          */
/* ------------------------------------------------------------------ */

type Turn = (seq: number) => AIMessage;

/**
 * Fluent builder for a deterministic model whose behaviour is a fixed SEQUENCE
 * of turns: the first `respond()` yields turn 1, the next yields turn 2, and so
 * on. Ideal for a known agentic script — e.g. "request a tool, then summarize".
 */
export class ScriptedModelBuilder {
  private readonly turns: Turn[] = [];

  /** Emit a plain assistant message (optionally carrying `additional_kwargs`). */
  say(
    text: string,
    options: { additionalKwargs?: Record<string, unknown> } = {},
  ): this {
    const additionalKwargs = options.additionalKwargs ?? {};
    this.turns.push(
      () => new AIMessage({ content: text, additional_kwargs: additionalKwargs }),
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

  /** Compile the script into an injectable model class. */
  build(): Type<ScriptedChatModel> {
    const turns = [...this.turns];

    @Injectable()
    class ScriptedModel implements ScriptedChatModel {
      private cursor = 0;

      respond(): AIMessage {
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
 * calls plus optional `additional_kwargs`.
 */
export type RuleResult =
  | string
  | AIMessage
  | {
      text?: string;
      toolCalls?: ToolCallSpec[];
      additionalKwargs?: Record<string, unknown>;
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
    );
  }
  return new AIMessage({
    content: result.text ?? "",
    additional_kwargs: additionalKwargs,
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

  /** Compile the rules into an injectable model class. */
  build(): Type<ScriptedChatModel> {
    const toolResultRule = this.toolResultRule;
    const humanRules = [...this.humanRules];
    const fallbackRule = this.fallbackRule;

    @Injectable()
    class RuleModel implements ScriptedChatModel {
      private seq = 0;

      respond(messages: BaseMessage[]): AIMessage {
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
      }
    }

    return RuleModel;
  }
}

/** Start a rule-based model. See {@link RuleModelBuilder}. */
export function ruleModel(): RuleModelBuilder {
  return new RuleModelBuilder();
}
