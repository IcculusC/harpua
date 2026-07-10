# @harpua/models

## 0.1.2

### Patch Changes

- f2413a8: The openrouter arm passes `sessionId` through to ChatOpenRouter — `OPENROUTER_SESSION_ID` env (prefix-aware, per house convention) or `defaults.openrouter.sessionId`, env winning. Groups an app's requests into OpenRouter dashboard sessions. Requested by the notebook consumer app (which sets it to its thread/project id at launch).

## 0.1.1

### Patch Changes

- 6e42596: Log one line per resolved chat-model registration at boot (Nest `Logger`,
  context `ChatModelModule`) naming the active arm and, for a real arm, the
  concrete model id — e.g. `model "default" -> mock (built-in)` /
  `model "fast" -> openrouter (deepseek/deepseek-v4-flash)`. Makes an env flip
  visible instead of silent; never logs api keys or base URLs.

## 0.1.0

### Minor Changes

- 1aaa2df: New package `@harpua/models`: env-driven NestJS chat models by named registration. `ChatModelModule.forRoot()` registers the default model (injectable via `CHAT_MODEL` / `@InjectChatModel()`), `register({ name })` adds SCREAMING_SNAKE-prefixed named models, and `@InjectChatModel(name?)` resolves them. Arms: a zero-config offline `MockChatModel` default plus OpenRouter (the recommended real arm — one key, every model), Ollama, and openai-compatible, each an optional peer loaded lazily with an install hint. Validation is zod-first with precedence env > defaults > error.
