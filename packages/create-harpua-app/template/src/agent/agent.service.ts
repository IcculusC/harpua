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

import { WeatherAgentGraph, type AgentState } from "./weather-agent.graph";
import { textOf } from "./mock-chat-model";

export interface AgentTurn {
  /** Assistant text produced by this turn (non-empty AI message contents). */
  messages: string[];
  /** Interrupt payload if the graph paused waiting for approval. */
  interrupt?: unknown;
  /** Every message appended during this turn (the CLI uses this for tool lines). */
  newMessages: BaseMessage[];
}

@Injectable()
export class AgentService {
  constructor(
    @InjectLangGraphRunnable(WeatherAgentGraph)
    private readonly agent: LangGraphRunnable<AgentState>,
  ) {}

  async ask(threadId: string, message: string): Promise<AgentTurn> {
    const before = await this.messageCount(threadId);
    const result = await this.agent.invoke(
      { messages: [new HumanMessage(message)] },
      { configurable: { thread_id: threadId } },
    );
    // Skip the human message we just appended.
    return this.toTurn(result, before + 1);
  }

  /**
   * Resumes a thread paused on an approval-gated tool. `{ approved: true }` runs
   * the pending tool; `{ approved: false, reason? }` declines it. The tool's
   * approval interrupt was raised on this exact thread, so `threadId` is
   * mandatory.
   */
  async resume(
    threadId: string,
    decision: { approved: boolean; reason?: string },
  ): Promise<AgentTurn> {
    const before = await this.messageCount(threadId);
    const result = await this.agent.resume(threadId, decision);
    return this.toTurn(result, before);
  }

  async history(threadId: string): Promise<BaseMessage[]> {
    const snapshot = await this.agent.getState({
      configurable: { thread_id: threadId },
    });
    return ((snapshot.values as AgentState | undefined)?.messages ??
      []) as BaseMessage[];
  }

  private async messageCount(threadId: string): Promise<number> {
    return (await this.history(threadId)).length;
  }

  private toTurn(result: AgentState, sinceIndex: number): AgentTurn {
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
