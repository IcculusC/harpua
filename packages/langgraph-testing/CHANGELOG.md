# @harpua/langgraph-testing

## 1.0.0-next.0

### Major Changes

- 70fa6cb: Requires NestJS 12 (peer range `^12.0.0`). Migration: upgrade `@nestjs/common`, `@nestjs/core` (and `@nestjs/testing` if you use it) to v12 on Node 20.19+, 22.12+ or 24+. Still ships CommonJS; Nest 12's ESM-only packages load through Node's `require(esm)`. Jest cannot load Nest 12 on its own, see the Nest 12 migration guide.

### Patch Changes

- Updated dependencies [70fa6cb]
  - @harpua/langgraph@1.0.0-next.0

## 0.3.0

### Minor Changes

- 433419e: Add `.structured(value)` to the `ruleModel()` builder (`RuleModelBuilder`), matching the existing method on `scriptedModel()`'s `ScriptedModelBuilder`. This lets a rule-based fake serve as both a tool-loop model and a `withStructuredOutput` summarizer in the same test — required to end-to-end exercise the context-compaction `summarize` strategy against a real checkpointer.

### Patch Changes

- 7727f78: Widen the `@harpua/langgraph` peer range from `workspace:^` (which published as a minor-locked `^0.1.6` in 0.x) to `>=0.1.6 <1.0.0`. The shipped testing surface (scripted models, the Nest testing-module harness) is stable across langgraph's 0.x minors, so a langgraph minor should not force a `langgraph-testing` major. This keeps versions honest — langgraph-testing tracks langgraph across the whole 0.x line and takes its own 0.x bumps — until langgraph reaches 1.0.

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
