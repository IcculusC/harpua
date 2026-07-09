# @harpua/langgraph-testing

## 0.2.1

### Patch Changes

- d6706a1: scripted fakes support usage_metadata and withStructuredOutput
  `createGraphTestingModule` gains a `featureProviders` option that registers providers inside `forFeature`'s scope, so an agent whose middleware needs DI-configured options (e.g. `provideBudget`/`provideRetry`) can be booted and tested with the normal harness.
- Updated dependencies [d6706a1]
  - @harpua/langgraph@0.1.6

## 0.2.0

### Minor Changes

- 87f7ce4: `scriptedModel()`/`ruleModel()` now build genuine `BaseChatModel` subclasses. The fake produced by `.build()` extends `@langchain/core`'s `BaseChatModel` and is driven with `.invoke(messages)` — so it drops in anywhere LangChain expects a model (vanilla LangGraph, our graphs, DI factories), with `bindTools` a no-op that returns the model and a `reset()` to rewind scripted state.

  BREAKING: the produced class no longer exposes `respond(messages) => AIMessage`; call `.invoke(messages)` (async) instead. The builder APIs (`say`/`toolCall`/`toolCalls`/`emit`/`onToolResult`/`onHuman`/`fallback`/`reset`) are unchanged. The `ScriptedChatModel` type is deprecated — it is now an alias for the new `FakeChatModel` (`BaseChatModel & { reset(): void }`); prefer `FakeChatModel` or `BaseChatModel`. The `textOf` helper is unchanged.

### Patch Changes

- Updated dependencies [4e6d572]
  - @harpua/langgraph@0.1.1
