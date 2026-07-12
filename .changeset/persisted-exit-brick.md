---
"@harpua/langgraph": minor
---

Fix: a budget exit persisted on a thread no longer permanently exits it. The
agent loop's beforeAgent segment now chains unconditionally, with the exit
check on its last node's outbound edge — previously every hook node routed on
`exit.requested`, so a thread's PERSISTED exit from the previous turn
short-circuited the next invoke to the exit path before `BudgetMiddleware`'s
per-invoke reset (`reset: "invoke"`, the default) could run, whenever any
`beforeAgent` middleware was listed before Budget. Every subsequent turn then
re-reported the stale `budget:<cap>` doing zero work, and `loop.startedAt`
never re-anchored. Human-in-the-loop agents hit this easily: `maxWallMs`
counts time suspended at an `interrupt()` approval, so one slow approval
walled the turn and the ordering bug made it permanent.

Semantic corollary of the fix (documented): all `beforeAgent` hooks now run
before the exit flag routes, so a fresh `ctx.exit()` from a `beforeAgent`
hook no longer skips later beforeAgent siblings — and a reset-style hook that
runs after it would clear it. If one of your `beforeAgent` hooks exits, list
`BudgetMiddleware` first. `beforeModel`/`afterModel`/`afterAgent` routing is
unchanged, as are `reset: "thread"` semantics.
