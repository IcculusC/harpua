---
"@harpua/langgraph": patch
---

`@LangGraphAgent({ model })` and `provideGraphBoundModel` accept a `lazyModel(token)` marker that defers model resolution from feature-init to the graph's first model call. This lets a graph bind a named model arm registered by a later module without a boot crash, replacing the placeholder-plus-middleware workaround. A bare token keeps its exact current behavior; a lazy arm that is still unregistered at first use throws loudly on every call rather than hanging.
