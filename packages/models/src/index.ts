import "reflect-metadata";

// Module.
export { ChatModelModule } from "./chat-model.module.js";

// Tokens + token helper.
export {
  CHAT_MODEL,
  CHAT_MODEL_MODULE_OPTIONS,
  getChatModelToken,
  MODEL_PACKAGES,
} from "./constants.js";

// Injection decorator.
export { InjectChatModel } from "./decorators.js";

// Built-in mock model.
export { MockChatModel } from "./mock-chat-model.js";

// Model factory (usable standalone, outside DI).
export { buildChatModel } from "./model-factory.js";

// Test isolation: reset process-wide registry state between app boots. See its
// doc comment — a process booting multiple apps (e.g. an e2e suite) must call
// this between boots, since a second forRoot() otherwise throws.
export { resetChatModelRegistry } from "./registry.js";

// Zod schemas + inferred types for the public option shapes.
export {
  MODEL_PROVIDERS,
  ModelProviderSchema,
  ModelDefaultsSchema,
  OpenRouterDefaultsSchema,
  OllamaDefaultsSchema,
  OpenAICompatibleDefaultsSchema,
  ForRootOptionsSchema,
  RegisterOptionsSchema,
  ModelNameSchema,
} from "./interfaces.js";
export type {
  ModelProvider,
  ModelDefaults,
  OpenRouterDefaults,
  OllamaDefaults,
  OpenAICompatibleDefaults,
  MockModelFactory,
  ForRootOptions,
  RegisterOptions,
  Registration,
} from "./interfaces.js";
