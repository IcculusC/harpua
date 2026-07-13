---
"@harpua/langgraph": minor
---

Cost-aware budgets: a `costOf` seam on `@LangGraphAgent` accumulates app-defined per-reply spend (e.g. OpenRouter's `response_metadata.tokenUsage.cost`) into a new `loop.cost` counter, and `BudgetOptions.maxCost` caps it with a `budget:cost` exit. Face-value token counts re-count cached prefixes every cycle under a compaction-managed window, so `maxTokens` trips at many times the real spend on exactly the long turns that need room — `maxCost` measures what the budget actually guards. Unopted behavior is unchanged (`loop.cost` stays 0; `maxCost` is optional); a loop checkpointed before `cost` existed resumes as 0 (healed at schema validation, so wall-credit resumes and `reset: "thread"` threads survive the upgrade), and a `costOf` returning a non-finite number throws instead of silently disarming the cap. `BudgetOptions` is now `.strict()`: an unknown key (e.g. a typo'd `maxCosts`) throws at boot instead of silently leaving spend unguarded.
