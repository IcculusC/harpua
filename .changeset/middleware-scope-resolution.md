---
"@harpua/langgraph": minor
---

Middleware named in a `@LangGraphAgent`'s `middleware: [...]` now resolves within the owning graph's feature module, fixing silent cross-contamination when two graphs name the same middleware class with different scope-level options: the old flat-by-class lookup let one scope's instance govern every graph (live incident: a subagent's small Budget capping the flagship graph). All three resolution paths are scoped — node-hook middleware, `wrapModelCall`, and `wrapToolCall` (the ToolNode assembly resolves through a per-agent owner-module-ref provider, since the registry's own `ModuleRef` is root-scoped).

Behavior change (why this is a minor): the graph's own feature scope now deterministically wins for agent-listed middleware. An app that overrode such a class from OUTSIDE the feature module (e.g. `{ provide: BudgetMiddleware, useClass: VerboseBudget }` in a later-registered module, relying on the old last-registered-wins flat lookup) must move that override into the graph's `forFeature` providers, where it belongs. Middleware that only ever lives in one scope — the documented pattern — is unaffected.
