import type { Provider } from "@nestjs/common";
import { z } from "zod";
import type { BaseMessage } from "@langchain/core/messages";
import { ChatOllama } from "@langchain/ollama";
import { ChatOpenAI } from "@langchain/openai";

import { MockChatModel } from "./mock-chat-model";

/** DI token for the chat model backing the agent's `CallModelNode`. */
export const CHAT_MODEL = Symbol("CHAT_MODEL");

/**
 * The minimal model surface the node depends on — every LangChain chat model
 * (ChatOpenAI, ChatOllama, our MockChatModel) satisfies it structurally. Typed
 * this way rather than as `BaseChatModel` on purpose: each concrete model
 * narrows `BaseChatModel`'s generic `CallOptions`, and assigning those back to a
 * fixed `BaseChatModel` trips TypeScript's protected-member check under some
 * toolchains. A structural surface is portable and is all the node calls.
 */
export interface ChatModel {
  invoke(messages: BaseMessage[]): Promise<BaseMessage>;
}

/**
 * Environment contract for model selection, validated with zod. `superRefine`
 * enforces the conditional requirements each provider arm has (e.g. an
 * openai-compatible base URL) — a misconfiguration fails fast at boot with a
 * precise message instead of at the first request.
 */
const envSchema = z
  .object({
    MODEL_PROVIDER: z
      .enum(["mock", "ollama", "openai-compatible"])
      .default("mock"),

    OLLAMA_BASE_URL: z.string().url().default("http://localhost:11434"),
    OLLAMA_MODEL: z.string().min(1).default("llama3.1"),

    OPENAI_COMPATIBLE_BASE_URL: z.string().url().optional(),
    OPENAI_COMPATIBLE_API_KEY: z.string().optional(),
    OPENAI_COMPATIBLE_MODEL: z.string().min(1).default("gpt-4o-mini"),
  })
  .superRefine((env, ctx) => {
    if (env.MODEL_PROVIDER === "openai-compatible" && !env.OPENAI_COMPATIBLE_BASE_URL) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["OPENAI_COMPATIBLE_BASE_URL"],
        message:
          "OPENAI_COMPATIBLE_BASE_URL is required when MODEL_PROVIDER=openai-compatible",
      });
    }
  });

export type ModelEnv = z.infer<typeof envSchema>;

/** Build the configured chat model, logging which provider is active. */
export function createChatModel(
  rawEnv: NodeJS.ProcessEnv = process.env,
): ChatModel {
  const env = envSchema.parse(rawEnv);

  switch (env.MODEL_PROVIDER) {
    case "ollama": {
      logProvider(`ollama (${env.OLLAMA_MODEL} @ ${env.OLLAMA_BASE_URL})`);
      return new ChatOllama({
        model: env.OLLAMA_MODEL,
        baseUrl: env.OLLAMA_BASE_URL,
      });
    }
    case "openai-compatible": {
      logProvider(
        `openai-compatible (${env.OPENAI_COMPATIBLE_MODEL} @ ${env.OPENAI_COMPATIBLE_BASE_URL})`,
      );
      return new ChatOpenAI({
        model: env.OPENAI_COMPATIBLE_MODEL,
        // Local/self-hosted servers often ignore the key; send a placeholder
        // so the client doesn't refuse to start when none is configured.
        apiKey: env.OPENAI_COMPATIBLE_API_KEY ?? "not-needed",
        configuration: { baseURL: env.OPENAI_COMPATIBLE_BASE_URL },
      });
    }
    default: {
      logProvider("mock (deterministic, offline)");
      return new MockChatModel();
    }
  }
}

function logProvider(active: string): void {
  console.log(
    `[chat-model] MODEL_PROVIDER=${active}. ` +
      "Switch with MODEL_PROVIDER=mock|ollama|openai-compatible.",
  );
}

/** Nest provider wiring the factory to the {@link CHAT_MODEL} token. */
export const chatModelProvider: Provider = {
  provide: CHAT_MODEL,
  useFactory: (): ChatModel => createChatModel(),
};
