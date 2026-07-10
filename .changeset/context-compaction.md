---
"@harpua/langgraph": minor
---

Add the context-compaction middleware family and flip Budget to per-invoke reset.

- `CompactionMiddleware` (fold): a `beforeModel` hook that durably shrinks the
  `messages` channel with `RemoveMessage` + hysteresis, cutting only at
  `HumanMessage` boundaries. Strategies: `drop` (default, lossless-to-external
  memory) and `summarize` (opt-in, structured summary via `withStructuredOutput`).
- `ContextWindowMiddleware` (view): assembles the cache-coherent render layout
  `[system+tools ‖ pinned head + summary ‖ tail]` and stamps provider-agnostic
  cache boundaries (translated to Anthropic `cache_control`, no-op elsewhere).
- `ManagedContextMiddleware`: one-entry DI-delegation bundle over the two.
- `provideCompaction`/`provideContextWindow`/`provideManagedContext`: DI
  provider helpers for each. Their parameter types now accept partial option
  literals (the `z.input` shape) — defaulted fields (`strategy`, `cacheHints`,
  `evictToolOutputs`) are filled by `.parse()` at call time, so
  `provideManagedContext({ triggerAt: { messages: 50 }, keepRecent: 4 })`
  typechecks without spelling out every default.

**BREAKING (behavior): `Budget` now resets `loop`/`exit` per-invoke by
default** (`reset: "invoke"`). Long-lived threads no longer silently
accumulate into a permanent exit across separate `invoke` calls on the same
thread. Pass `reset: "thread"` to `provideBudget` for the previous
lifetime-scoped semantics. `clearAgentExit()` is a new escape hatch to clear a
stuck `exit.requested` via `graph.updateState` when running with
`reset: "thread"`.

Internal: `hook-node.ts`'s `beforeAgent` dispatch now allows a `beforeAgent`
middleware's returned patch to reset `loop.startedAt` (previously only
`CallModelNode` anchored it on the first model turn) — this is what makes
Budget's per-invoke reset take effect before the first model call rather than
one turn late.

The `drop` strategy generalizes the interim compaction middleware from the first
`@harpua/langgraph@0.1.6` production adopter (datasheet notebook agent) — credit and thanks.
