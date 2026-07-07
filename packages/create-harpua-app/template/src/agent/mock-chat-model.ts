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

/** Reads a message's text, JSON-encoding non-string content. */
export function textOf(message: BaseMessage): string {
  return typeof message.content === "string"
    ? message.content
    : JSON.stringify(message.content);
}

/**
 * Captures a location out of a weather request, e.g.
 *   "what's the weather in San Francisco?" -> "San Francisco"
 *   "weather in berlin"                    -> "berlin"
 * Letters, spaces, and a few name punctuation chars; trailing "?" stops it.
 */
const WEATHER_PATTERN = /weather\b[\s\S]*?\bin\s+([a-z][a-z .'-]*)/i;

const HELP =
  "Hi! I'm a weather agent. Ask me about the weather in a place — " +
  'try "what\'s the weather in Berlin?". I can also think through a ' +
  "problem step by step before answering.";

/**
 * A deterministic, offline stand-in for a real chat model — a genuine
 * `BaseChatModel` (no network) driven with `.invoke()`. Its `_generate`
 * inspects the conversation and returns the next AIMessage:
 *
 * 1. Latest message is a ToolMessage -> summarize the real tool result (so mock
 *    mode still exercises the live Open-Meteo call at runtime).
 * 2. Latest human turn matches "weather ... in <place>" -> emit a `get_weather`
 *    tool_call for the captured location.
 * 3. Otherwise -> help text listing what the agent can do.
 *
 * Runtime code must not depend on a testing library, so this mock lives in the
 * project (not `@harpua/langgraph-testing`). Update {@link HELP} whenever you
 * teach the mock a new capability, or the help text goes stale.
 */
@Injectable()
export class MockChatModel extends BaseChatModel {
  private toolCallSeq = 0;

  constructor() {
    super({});
  }

  _llmType(): string {
    return "harpua-weather-mock";
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
      return new AIMessage(textOf(last));
    }

    const lastHuman = [...messages].reverse().find((m) => isHumanMessage(m));
    const text = lastHuman ? textOf(lastHuman) : "";
    const location = WEATHER_PATTERN.exec(text)?.[1]?.trim();

    if (location) {
      this.toolCallSeq += 1;
      return new AIMessage({
        content: "",
        tool_calls: [
          {
            name: "get_weather",
            args: { location },
            id: `call_${this.toolCallSeq}`,
            type: "tool_call",
          },
        ],
      });
    }

    return new AIMessage(HELP);
  }
}
