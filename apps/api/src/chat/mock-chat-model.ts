import { Injectable } from "@nestjs/common";
import {
  AIMessage,
  ToolMessage,
  isHumanMessage,
  type BaseMessage,
} from "@langchain/core/messages";
import {
  BaseChatModel,
  type BindToolsInput,
} from "@langchain/core/language_models/chat_models";
import type { ChatResult } from "@langchain/core/outputs";

export function textOf(message: BaseMessage): string {
  return typeof message.content === "string"
    ? message.content
    : JSON.stringify(message.content);
}

/**
 * Deterministic, scripted stand-in for a real chat model. It is a genuine
 * `BaseChatModel` (no network) driven with `.invoke()`, so it drops in wherever
 * LangChain expects a model. Its `_generate` inspects the conversation and
 * returns the next AIMessage:
 *
 * 1. Latest message is a ToolMessage  -> summarize the tool result.
 * 2. Latest human turn says delete/cancel of an order -> emit a synthetic
 *    tool_call for `cancel_order`. That tool is approval-gated in the framework,
 *    so the graph pauses for approval before it runs — no side-channel needed.
 * 3. Latest human turn mentions "order <id>" -> emit a synthetic tool_call
 *    for `lookup_order`.
 * 4. Otherwise -> canned assistant reply.
 */
@Injectable()
export class MockChatModel extends BaseChatModel {
  private toolCallSeq = 0;

  constructor() {
    super({});
  }

  _llmType(): string {
    return "harpua-mock-chat";
  }

  /** Tools are bound at the ToolNode level; this only needs to not crash. */
  bindTools(_tools: BindToolsInput[]): this {
    return this;
  }

  async _generate(messages: BaseMessage[]): Promise<ChatResult> {
    const message = this.reply(messages);
    return {
      generations: [
        {
          message,
          text: typeof message.content === "string" ? message.content : "",
        },
      ],
    };
  }

  private reply(messages: BaseMessage[]): AIMessage {
    const last = messages[messages.length - 1];
    if (last instanceof ToolMessage) {
      return new AIMessage(`Here's what I found: ${textOf(last)}`);
    }

    const lastHuman = [...messages].reverse().find((m) => isHumanMessage(m));
    const text = lastHuman ? textOf(lastHuman) : "";
    const orderId = /order\s+#?([A-Za-z0-9-]+)/i.exec(text)?.[1] ?? null;
    const wantsCancel = /\b(delete|cancel)\b/i.test(text);

    if (wantsCancel && orderId) {
      // A real cancel tool call — approval is enforced by the tool gate, not a
      // side-channel a real model could never set.
      return this.toolCall("cancel_order", orderId);
    }
    if (wantsCancel) {
      return new AIMessage(
        "Which order should I cancel? Tell me the order id.",
      );
    }
    if (orderId) {
      return this.toolCall("lookup_order", orderId);
    }

    return new AIMessage(
      'Hi! I can check an order for you (try "check order 42") or cancel one with your approval.',
    );
  }

  private toolCall(name: string, orderId: string): AIMessage {
    this.toolCallSeq += 1;
    return new AIMessage({
      content: "",
      tool_calls: [
        { name, args: { orderId }, id: `call_${this.toolCallSeq}`, type: "tool_call" },
      ],
    });
  }
}
