/**
 * DI token for the DEFAULT chat model registered via
 * {@link ChatModelModule.forRoot}. Inject it directly for the simple
 * single-model case, or use `@InjectChatModel()` (no argument) which resolves
 * to this same token.
 */
export const CHAT_MODEL = Symbol.for("@harpua/models:CHAT_MODEL");

/** DI token exposing the raw options passed to `forRoot` (mainly for tests). */
export const CHAT_MODEL_MODULE_OPTIONS = Symbol.for(
  "@harpua/models:MODULE_OPTIONS",
);

/**
 * Builds the injection token for a named chat model registered via
 * {@link ChatModelModule.register}. The default model (name `"default"`, or no
 * name) always resolves to {@link CHAT_MODEL} so it stays directly injectable.
 */
export function getChatModelToken(name?: string): symbol | string {
  return !name || name === "default" ? CHAT_MODEL : `ChatModel:${name}`;
}

/** npm names of the optional LangChain integration packages (one per arm). */
export const MODEL_PACKAGES = {
  openrouter: "@langchain/openrouter",
  ollama: "@langchain/ollama",
  openai: "@langchain/openai",
} as const;
