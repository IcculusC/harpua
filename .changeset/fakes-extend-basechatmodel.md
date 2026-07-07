---
"@harpua/langgraph-testing": minor
---

`scriptedModel()`/`ruleModel()` now build genuine `BaseChatModel` subclasses. The fake produced by `.build()` extends `@langchain/core`'s `BaseChatModel` and is driven with `.invoke(messages)` — so it drops in anywhere LangChain expects a model (vanilla LangGraph, our graphs, DI factories), with `bindTools` a no-op that returns the model and a `reset()` to rewind scripted state.

BREAKING: the produced class no longer exposes `respond(messages) => AIMessage`; call `.invoke(messages)` (async) instead. The builder APIs (`say`/`toolCall`/`toolCalls`/`emit`/`onToolResult`/`onHuman`/`fallback`/`reset`) are unchanged. The `ScriptedChatModel` type is deprecated — it is now an alias for the new `FakeChatModel` (`BaseChatModel & { reset(): void }`); prefer `FakeChatModel` or `BaseChatModel`. The `textOf` helper is unchanged.
