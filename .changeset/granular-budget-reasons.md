---
"@harpua/langgraph": patch
---

BudgetMiddleware exit reasons are granular: `budget:cycles`, `budget:tool-calls`, `budget:tokens`, or `budget:wall` instead of an opaque `budget`, in that precedence order when several caps trip at once. Consumers that matched the old value exactly should switch to `startsWith("budget")`.
