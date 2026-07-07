import {
  AIMessage,
  isHumanMessage,
  type BaseMessage,
} from "@langchain/core/messages";
import {
  BaseChatModel,
  type BindToolsInput,
} from "@langchain/core/language_models/chat_models";
import type { ChatResult } from "@langchain/core/outputs";

/** Reads a message's text, JSON-encoding non-string content. */
function textOf(message: BaseMessage): string {
  return typeof message.content === "string"
    ? message.content
    : JSON.stringify(message.content);
}

/**
 * The built-in, zero-config chat model — a genuine `BaseChatModel` that makes
 * NO network calls and requires NO optional peer installed. It is the DEFAULT
 * arm (`MODEL_PROVIDER=mock`), so an app boots and answers with empty env.
 *
 * Its reply is deterministic and echoes the latest human turn, tagged with the
 * registration name so multi-model wiring is observable:
 *
 *   "[mock:default] you said: hello there"
 *
 * It never emits tool calls. To simulate a real model's behaviour in a demo or
 * test, supply your own `BaseChatModel` via a registration's
 * `defaults.mockModel` factory instead of this stand-in.
 */
export class MockChatModel extends BaseChatModel {
  constructor(private readonly registrationName: string = "default") {
    super({});
  }

  _llmType(): string {
    return "harpua-mock";
  }

  /** Tools are bound elsewhere; this only needs to not crash. */
  bindTools(_tools: BindToolsInput[]): this {
    return this;
  }

  async _generate(messages: BaseMessage[]): Promise<ChatResult> {
    const message = this.reply(messages);
    return {
      generations: [{ message, text: textOf(message) }],
    };
  }

  private reply(messages: BaseMessage[]): AIMessage {
    const lastHuman = [...messages].reverse().find((m) => isHumanMessage(m));
    const said = lastHuman ? textOf(lastHuman) : "";
    const content = said
      ? `[mock:${this.registrationName}] you said: ${said}`
      : `[mock:${this.registrationName}] ready — send a message to get an echo.`;
    return new AIMessage(content);
  }
}
