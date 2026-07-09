---
"@harpua/langgraph-testing": patch
---

scripted fakes support usage_metadata and withStructuredOutput
 `createGraphTestingModule` gains a `featureProviders` option that registers providers inside `forFeature`'s scope, so an agent whose middleware needs DI-configured options (e.g. `provideBudget`/`provideRetry`) can be booted and tested with the normal harness.