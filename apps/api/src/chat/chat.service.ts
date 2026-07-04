import { Injectable } from "@nestjs/common";
import {
  HumanMessage,
  isAIMessage,
  type BaseMessage,
} from "@langchain/core/messages";
import {
  InjectLangGraphRunnable,
  type LangGraphRunnable,
} from "@harpua/langgraph";

import { ChatGraph, type ChatState } from "./chat.graph";
import { textOf } from "./mock-chat-model";

export interface ChatTurn {
  /** Assistant text produced by this turn (non-empty AI message contents). */
  messages: string[];
  /** Interrupt payload if the graph paused waiting for approval. */
  interrupt?: unknown;
  /** Raw messages appended during this turn (used by the CLI for tool lines). */
  newMessages: BaseMessage[];
}

@Injectable()
export class ChatService {
  constructor(
    @InjectLangGraphRunnable(ChatGraph)
    private readonly graph: LangGraphRunnable<ChatState>,
  ) {}

  async send(threadId: string, message: string): Promise<ChatTurn> {
    const before = await this.messageCount(threadId);
    const result = await this.graph.invoke(
      { messages: [new HumanMessage(message)] },
      { configurable: { thread_id: threadId } },
    );
    // Skip the human message we just appended.
    return this.toTurn(result, before + 1);
  }

  async resume(threadId: string, approved: boolean): Promise<ChatTurn> {
    const before = await this.messageCount(threadId);
    const result = await this.graph.resume(threadId, { approved });
    return this.toTurn(result, before);
  }

  async history(threadId: string): Promise<BaseMessage[]> {
    const snapshot = await this.graph.getState({
      configurable: { thread_id: threadId },
    });
    return ((snapshot.values as ChatState | undefined)?.messages ??
      []) as BaseMessage[];
  }

  private async messageCount(threadId: string): Promise<number> {
    return (await this.history(threadId)).length;
  }

  private toTurn(result: ChatState, sinceIndex: number): ChatTurn {
    const newMessages = result.messages.slice(sinceIndex);
    const messages = newMessages
      .filter((m) => isAIMessage(m))
      .map((m) => textOf(m))
      .filter((text) => text.length > 0);
    const interrupts = (result as Record<string, unknown>).__interrupt__ as
      | Array<{ value: unknown }>
      | undefined;
    const pending = interrupts?.[0];
    return {
      messages,
      newMessages,
      ...(pending ? { interrupt: pending.value } : {}),
    };
  }
}
