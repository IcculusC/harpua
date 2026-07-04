import { Injectable } from "@nestjs/common";
import {
  HumanMessage,
  isAIMessage,
  type BaseMessage,
} from "@langchain/core/messages";
import {
  InjectLangGraphRunnable,
  getStreamedInterrupts,
  type LangGraphRunnable,
  type NodeUpdate,
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

/** A per-node progress event streamed while a turn runs. */
export interface ChatUpdateEvent {
  kind: "update";
  /** Graph node id that produced this update (e.g. "CallModelNode", "tools"). */
  node: string;
  /** Assistant text this node contributed, if any. */
  messages: string[];
}

/** The terminal event: the turn's assistant text, plus an interrupt if it paused. */
export interface ChatFinalEvent {
  kind: "final";
  messages: string[];
  interrupt?: unknown;
}

export type ChatStreamEvent = ChatUpdateEvent | ChatFinalEvent;

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

  /**
   * Streams a turn super-step by super-step. Yields a `ChatUpdateEvent` per node
   * update (named after the node), then exactly one terminal `ChatFinalEvent`
   * carrying the assistant text — or the interrupt payload if the graph paused
   * for approval.
   *
   * Uses `updates` mode: with the deterministic MockChatModel that's the
   * demonstrable mode (each node's contribution is visible). Real LLM token
   * streaming would use `streamMessages` against a streaming chat model.
   */
  async *streamTurn(
    threadId: string,
    message: string,
  ): AsyncGenerator<ChatStreamEvent> {
    const stream = await this.graph.streamUpdates(
      { messages: [new HumanMessage(message)] },
      { configurable: { thread_id: threadId } },
    );

    const assistant: string[] = [];
    let interrupt: unknown;

    for await (const chunk of stream) {
      const interrupts = getStreamedInterrupts(chunk);
      if (interrupts) {
        interrupt = interrupts[0]?.value;
        continue;
      }
      for (const [node, patch] of Object.entries(
        chunk as NodeUpdate<ChatState>,
      )) {
        const texts = this.assistantTextsOf(patch as Partial<ChatState>);
        assistant.push(...texts);
        yield { kind: "update", node, messages: texts };
      }
    }

    yield {
      kind: "final",
      messages: assistant,
      ...(interrupt !== undefined ? { interrupt } : {}),
    };
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

  private assistantTextsOf(patch: Partial<ChatState>): string[] {
    return (patch.messages ?? [])
      .filter((m) => isAIMessage(m))
      .map((m) => textOf(m))
      .filter((text) => text.length > 0);
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
