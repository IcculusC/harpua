---
"create-harpua-app": patch
---

The scaffolded template now gets its chat model from `@harpua/models` (`ChatModelModule.forRoot(...)` + `@InjectChatModel()`) instead of a hand-rolled `chat-model.provider.ts` factory. It keeps the scripted weather `MockChatModel` as the mock arm's factory (mock-by-default is unchanged) and adds OpenRouter as the recommended real arm. README and `.env.example` document the new `MODEL_PROVIDER` options.
