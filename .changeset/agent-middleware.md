---
"@harpua/langgraph": patch
---

Add the agent-loop + middleware system. `@LangGraphAgent` is a declarative preset for the model↔tools loop that lowers transparently to primitives (fully ejectable and addressable). `@LangGraphMiddleware` provides DI-provider middleware with node hooks (`beforeAgent`/`beforeModel`/`afterModel`/`afterAgent`, inserted as graph nodes) and callable-wrap hooks (`wrapModelCall`/`wrapToolCall`, composed around the bound model and each tool). `responseFormat` coerces the final answer to a typed `outcome`; reserved persisted `loop`/`exit` state channels back the middleware. Ships two reference middlewares: `BudgetMiddleware` (graceful cycle/tool-call/token/wall-time guard) and `RetryMiddleware` (model + tool retry with shared backoff). Also: `LangGraphModule.forFeature` gains an optional second `{ providers }` argument (to register middleware option providers alongside a feature's agents), and `provideGraphBoundModel` now resolves its model token non-strictly so it works across module scopes.

`CallModelNode` now increments `loop.toolCalls` from each reply's requested tool calls, so `BudgetMiddleware`'s `maxToolCalls` cap actually fires (previously nothing incremented that counter). Note the `loop`/`exit` state channels are persisted per checkpointed thread and are not reset per `invoke` — budgets and exits are effectively thread-lifetime scoped; start a new thread id for a fresh run.

Documents the feature in the `graph-operations` agent-skill catalog (`references/agents-and-middleware.md` + router entry) so agents building a model↔tools loop discover the preset instead of hand-rolling it.
