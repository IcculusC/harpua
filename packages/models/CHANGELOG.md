# @harpua/models

## 0.1.0

### Minor Changes

- 1aaa2df: New package `@harpua/models`: env-driven NestJS chat models by named registration. `ChatModelModule.forRoot()` registers the default model (injectable via `CHAT_MODEL` / `@InjectChatModel()`), `register({ name })` adds SCREAMING_SNAKE-prefixed named models, and `@InjectChatModel(name?)` resolves them. Arms: a zero-config offline `MockChatModel` default plus OpenRouter (the recommended real arm — one key, every model), Ollama, and openai-compatible, each an optional peer loaded lazily with an install hint. Validation is zod-first with precedence env > defaults > error.
