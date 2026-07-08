import { Injectable } from "@nestjs/common";
import { SystemMessage } from "@langchain/core/messages";
import { z } from "zod";

/**
 * BCP 47-ish language tag: "en", "es", "pt-BR", "zh-Hans". Rendered to a
 * display name via Intl so the prompt says "Spanish", not "es".
 */
const languageTagSchema = z
  .string()
  .regex(
    /^[a-z]{2,3}(-[A-Za-z]{2,8})*$/,
    'CHAT_LANGUAGE must be a language tag like "en", "es", or "pt-BR"',
  );

const envSchema = z.object({
  CHAT_LANGUAGE: languageTagSchema.default("en"),
});

/**
 * Builds the demo's system message. Real models get no instructions at all
 * without this and improvise their own persona (and language — DeepSeek greets
 * a bare "hi" in Chinese). The scripted MockChatModel ignores system messages,
 * so mock-mode behavior is unchanged.
 */
@Injectable()
export class SystemPrompt {
  private readonly message: SystemMessage;

  constructor() {
    const { CHAT_LANGUAGE } = envSchema.parse({
      CHAT_LANGUAGE: process.env.CHAT_LANGUAGE,
    });
    const language =
      new Intl.DisplayNames(["en"], { type: "language" }).of(CHAT_LANGUAGE) ??
      CHAT_LANGUAGE;
    this.message = new SystemMessage(
      "You are the harpua chat demo's order assistant. You can look up " +
        "orders and, with the user's explicit approval, cancel them. Be " +
        `concise. Always respond in ${language}.`,
    );
  }

  /** The system message to prepend to every model call. */
  asMessage(): SystemMessage {
    return this.message;
  }
}
