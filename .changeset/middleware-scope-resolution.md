---
"@harpua/langgraph": patch
---

Middleware now resolves within the owning graph's feature module first (flat container fallback), fixing silent cross-contamination when two graphs name the same middleware class with different scope-level options: the flat-by-class lookup let one scope's instance govern every graph (live incident: a subagent's small Budget capping the flagship graph). All three resolution paths are scoped — node-hook middleware, `wrapModelCall`, and `wrapToolCall` (the ToolNode assembly resolves through a per-agent owner-module-ref provider, since the registry's own `ModuleRef` is root-scoped). Middleware provided outside the feature module keeps resolving flat, so existing setups are unaffected.
