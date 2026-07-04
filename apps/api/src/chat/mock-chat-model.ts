import { Injectable } from "@nestjs/common";
import {
  AIMessage,
  ToolMessage,
  isHumanMessage,
  type BaseMessage,
} from "@langchain/core/messages";

export interface PendingAction {
  action: "cancel_order";
  orderId: string | null;
  request: string;
}

export function textOf(message: BaseMessage): string {
  return typeof message.content === "string"
    ? message.content
    : JSON.stringify(message.content);
}

/**
 * Deterministic, scripted stand-in for a real chat model. It is a plain
 * injectable service (no LangChain model classes, no network) that inspects
 * the conversation and returns the next AIMessage:
 *
 * 1. Latest message is a ToolMessage  -> summarize the tool result.
 * 2. Latest human turn says delete/cancel -> flag a pending action so the
 *    graph routes through the approval interrupt.
 * 3. Latest human turn mentions "order <id>" -> emit a synthetic tool_call
 *    for `lookup_order`.
 * 4. Otherwise -> canned assistant reply.
 */
@Injectable()
export class MockChatModel {
  private toolCallSeq = 0;

  respond(messages: BaseMessage[]): AIMessage {
    const last = messages[messages.length - 1];
    if (last instanceof ToolMessage) {
      return new AIMessage(`Here's what I found: ${textOf(last)}`);
    }

    const lastHuman = [...messages].reverse().find((m) => isHumanMessage(m));
    const text = lastHuman ? textOf(lastHuman) : "";
    const orderId = /order\s+#?([A-Za-z0-9-]+)/i.exec(text)?.[1] ?? null;

    if (/\b(delete|cancel)\b/i.test(text)) {
      const pending: PendingAction = {
        action: "cancel_order",
        orderId,
        request: text,
      };
      return new AIMessage({
        content: orderId
          ? `Cancelling order ${orderId} is irreversible — I need your approval first.`
          : "That's a destructive action — I need your approval first.",
        additional_kwargs: { pending_action: pending },
      });
    }

    if (orderId) {
      this.toolCallSeq += 1;
      return new AIMessage({
        content: "",
        tool_calls: [
          {
            name: "lookup_order",
            args: { orderId },
            id: `call_${this.toolCallSeq}`,
            type: "tool_call",
          },
        ],
      });
    }

    return new AIMessage(
      'Hi! I can check an order for you (try "check order 42") or cancel one with your approval.',
    );
  }
}
