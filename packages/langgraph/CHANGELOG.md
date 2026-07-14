# @harpua/langgraph

## 0.6.0

### Minor Changes

- ec485c7: Middleware named in a `@LangGraphAgent`'s `middleware: [...]` now resolves within the owning graph's feature module, fixing silent cross-contamination when two graphs name the same middleware class with different scope-level options: the old flat-by-class lookup let one scope's instance govern every graph (live incident: a subagent's small Budget capping the flagship graph). All three resolution paths are scoped — node-hook middleware, `wrapModelCall`, and `wrapToolCall` (the ToolNode assembly resolves through a per-agent owner-module-ref provider, since the registry's own `ModuleRef` is root-scoped).

  Behavior change (why this is a minor): the graph's own feature scope now deterministically wins for agent-listed middleware. An app that overrode such a class from OUTSIDE the feature module (e.g. `{ provide: BudgetMiddleware, useClass: VerboseBudget }` in a later-registered module, relying on the old last-registered-wins flat lookup) must move that override into the graph's `forFeature` providers, where it belongs. Middleware that only ever lives in one scope — the documented pattern — is unaffected.

## 0.5.0

### Minor Changes

- 83405d4: Cost-aware budgets: a `costOf` seam on `@LangGraphAgent` accumulates app-defined per-reply spend (e.g. OpenRouter's `response_metadata.tokenUsage.cost`) into a new `loop.cost` counter, and `BudgetOptions.maxCost` caps it with a `budget:cost` exit. Face-value token counts re-count cached prefixes every cycle under a compaction-managed window, so `maxTokens` trips at many times the real spend on exactly the long turns that need room — `maxCost` measures what the budget actually guards. Unopted behavior is unchanged (`loop.cost` stays 0; `maxCost` is optional); a loop checkpointed before `cost` existed resumes as 0 (healed at schema validation, so wall-credit resumes and `reset: "thread"` threads survive the upgrade), and a `costOf` returning a non-finite number throws instead of silently disarming the cap. `BudgetOptions` is now `.strict()`: an unknown key (e.g. a typo'd `maxCosts`) throws at boot instead of silently leaving spend unguarded.

## 0.4.0

### Minor Changes

- 3ece1c2: Fix: a budget exit persisted on a thread no longer permanently exits it. The
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

- 0e1d0b3: New `ProviderGuardrailMiddleware` (`provideProviderGuardrail({ on?, retries?, note?, reasonOf? })`): neutralizes provider-side blocks before they poison history. A guardrail hit (`finish_reason: "content_filter"` by default) arrives as a normal-looking assistant message carrying the provider's canned refusal — checkpointed as-is, the next turn reads it back as the assistant's own words, concludes it refused, and redoes tool work that already succeeded. The middleware swaps the boilerplate for a note aimed at the model's next turn (marker `[[provider-guardrail:<reason>]]` for client rendering), keeps the evidence (`response_metadata`, zero-token usage, id) on the message, and can re-ask up to `retries` times first (worth 1 on stochastic multi-upstream routers). `reasonOf` bridges non-OpenAI reason keys (Google `finishReason`, Anthropic `stop_reason`). Also fixed alongside: `ContextWindowMiddleware` no longer writes its assembled view back onto the shared request — under any outer re-asker (this middleware's retries, RetryMiddleware's error path) the write-back re-assembled over its own output, duplicating the compaction summary per attempt.
- ce76f7e: `responseFormatOptions` opens the structured turn-ending call's four fixed choices, all defaults preserving today's behavior: `model` routes the envelope call to any injection token (a smart arm, or a facade provider encoding a fallback policy — this call sits outside `wrapModelCall`, so a token is its only routing seam), `retries` re-asks on thrown failures (provider roulette at the finish line lands after every tool call already succeeded), `messages` selects the envelope's input (a full-history resend prices like a second model call on long turns), and `instruction` replaces the fixed coercion system message.
- d3b6d25: `maxWallMs` now guards UNATTENDED runaway instead of raw wall-clock: when a
  `Command({ resume })` arrives for a thread suspended at an `interrupt()`, the
  graph facade shifts the reserved `loop.startedAt` anchor forward by the time
  the run spent suspended (measured from the halted checkpoint's timestamp), so
  a human deliberating at an approval prompt no longer burns the wall budget —
  previously one slow approval exited the resumed turn `budget:wall`. An active
  overrun (a tool or model genuinely consuming wall time) still trips the cap.
  The credit is applied per resume, accumulates across multiple approvals on a
  thread, and is skipped entirely — falling back to plain wall-clock — for
  non-`Command` input, a `resume` of `null`/`undefined` (LangGraph's own resume
  predicate), resumes pinned to an explicit `checkpoint_id`, graphs without the
  agent `loop` channel, threads with no pending interrupt, and threads the app
  edited via `updateState` while paused. It applies in `reset: "thread"` mode
  too: the lifetime wall now also measures unattended time.

### Patch Changes

- 1e65ab3: `provideGraphBoundModel` now throws a named error when the `model` token
  resolves to null ("model token <X> resolved to null — check the token's
  provider registration") instead of crashing with an anonymous
  `Cannot read properties of null (reading 'bindTools')` at first use. Also
  adds a per-call model routing recipe to the models skill reference:
  `provideGraphBoundModel({ model: getChatModelToken("smart") })` in the
  graph's `forFeature` scope + a `wrapModelCall` that swaps via
  `req.withModel` — the documented seam for "strong arm for one call, cheap
  arm for the loop".
- 302acda: `computeFold` can now fold mid-turn: when the protected tail is all ai/tool messages (a long tool loop) and no HumanMessage exists at/after the naive cut, the cut falls back to the LAST HumanMessage before it — keeping more than `keepRecent` (always safe) with the retained history still opening on a human. Previously the forward-only scan returned null every cycle exactly when relief was needed, so a token trigger fired forever while the whole tool loop rode at peak context.
- 5301d08: Token-based compaction triggers no longer go silently dead when a provider reports usage only via `response_metadata` (#61). `buildCompactionSignal` now falls back through `response_metadata.tokenUsage.prompt_tokens`/`promptTokens` and `response_metadata.usage.input_tokens`/`prompt_tokens` when `usage_metadata` is absent, and the agent preset's reply normalization is lossless — `response_metadata`, `additional_kwargs`, `invalid_tool_calls`, and `name` now survive to the checkpointed message for chunk and foreign-copy replies.

## 0.3.0

### Minor Changes

- 03de292: Two agent-loop seams from field reports:

  - **`systemPrompt` accepts a source function.** `systemPrompt` now takes
    `string | InjectionToken | (() => string | Promise<string>)`. A source
    function is re-invoked on every model turn, so the system-prompt prefix can
    be rebuilt from mutable state (e.g. a live skill menu) without a
    side-channel middleware — previously a DI-token prompt was fixed after
    first resolution (singleton providers memoize) and no form could express a
    runtime-rebuildable prefix. A class is always treated as a DI token; any
    other function is a source. Rebuilding the prefix resets prompt caching for
    the following turn — that trade-off is the caller's. Unchanged caveat, now
    documented: a request already leading with a persisted `SystemMessage`
    skips the prepend entirely, so a persisted leading `SystemMessage` pins the
    prompt even for a source.

  - **`lastNonSystemIsHuman` turn-start helper + `wrapModelCall` composition
    contract documented.** Composed `wrapModelCall` middlewares each receive
    the request as mutated by the middlewares outside them (onion order, first
    in the array = outermost). Two middlewares that both append a
    `SystemMessage` trailer and gate on "the last message is a `HumanMessage`"
    therefore collide: the outer one's trailer hides the human turn and the
    inner one silently never fires. The new `lastNonSystemIsHuman(messages)`
    export is the safe turn-start gate, and the mutated-request contract is now
    stated on the middleware interface docs.

## 0.2.1

### Patch Changes

- 21f19d7: BudgetMiddleware exit reasons are granular: `budget:cycles`, `budget:tool-calls`, `budget:tokens`, or `budget:wall` instead of an opaque `budget`, in that precedence order when several caps trip at once. Consumers that matched the old value exactly should switch to `startsWith("budget")`.

## 0.2.0

### Minor Changes

- 433419e: Add the context-compaction middleware family and flip Budget to per-invoke reset.

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

## 0.1.6

### Patch Changes

- d6706a1: Add the agent-loop + middleware system. `@LangGraphAgent` is a declarative preset for the model↔tools loop that lowers transparently to primitives (fully ejectable and addressable). `@LangGraphMiddleware` provides DI-provider middleware with node hooks (`beforeAgent`/`beforeModel`/`afterModel`/`afterAgent`, inserted as graph nodes) and callable-wrap hooks (`wrapModelCall`/`wrapToolCall`, composed around the bound model and each tool). `responseFormat` coerces the final answer to a typed `outcome`; reserved persisted `loop`/`exit` state channels back the middleware. Ships two reference middlewares: `BudgetMiddleware` (graceful cycle/tool-call/token/wall-time guard) and `RetryMiddleware` (model + tool retry with shared backoff). Also: `LangGraphModule.forFeature` gains an optional second `{ providers }` argument (to register middleware option providers alongside a feature's agents), and `provideGraphBoundModel` now resolves its model token non-strictly so it works across module scopes.

  `CallModelNode` now increments `loop.toolCalls` from each reply's requested tool calls, so `BudgetMiddleware`'s `maxToolCalls` cap actually fires (previously nothing incremented that counter). Note the `loop`/`exit` state channels are persisted per checkpointed thread and are not reset per `invoke` — budgets and exits are effectively thread-lifetime scoped; start a new thread id for a fresh run.

  Documents the feature in the `graph-operations` agent-skill catalog (`references/agents-and-middleware.md` + router entry) so agents building a model↔tools loop discover the preset instead of hand-rolling it.

## 0.1.5

### Patch Changes

- 0b9c12d: graph-operations skill (`tool.md`): add guidance on guarding a tool whose input is a model-supplied resource — a URL, filesystem path, or shell argument. Enforce the safe default in the handler rather than only documenting the risk; for URL fetches specifically, default-deny loopback/private/link-local/cloud-metadata hosts, restrict the scheme, and re-check the host after redirects.

## 0.1.4

### Patch Changes

- a1713aa: Add optional `approvalMessage` and `declineMessage` builders to approval-gated tools (`@LangGraphTool` and `requireApproval`). `approvalMessage(args)` surfaces custom wording in the interrupt payload (`ToolApprovalRequest` gains `message?: string`); `declineMessage(args, reason?)` overrides the default decline text. Both are only legal with `requiresApproval: true` (enforced at compile and registration), and are throw-safe — a throwing builder falls back and logs a warning rather than corrupting the run. Purely additive; tools without custom wording are unchanged.

## 0.1.3

### Patch Changes

- 0701c77: Add approval-gated tools: `@LangGraphTool({ requiresApproval: true })` and the raw-tool sibling `requireApproval(tool)` pause a tool with a `tool_approval_request` interrupt before it executes, running the real tool only on a resume with `{ approved: true }` (a decline returns a graceful ToolMessage the model can respond to). Enforcement lives in `buildGraphTools`, so it covers both the ToolNode executor and the model-bound schemas while keeping the model-facing tool identical to an unflagged one. The resume value is zod-validated. Exports `requireApproval` and the `ToolApprovalRequest` type. This replaces the mock-only `additional_kwargs` side-channel pattern, which a real LLM can never set.

## 0.1.2

### Patch Changes

- 07e9733: Add tool binding so a real chat model can emit the tool calls a graph's `TOOLS`
  node executes. New `provideGraphBoundModel({ provide, graph, model })` Nest
  custom-provider factory binds a graph's tools (`model.bindTools(...)`) to any
  DI token resolving to a `BaseChatModel` — the package stays model-library
  agnostic. Lower-level primitives `provideGraphTools({ graph })` +
  `getGraphToolsToken(graph)` expose the raw `StructuredToolInterface[]` for
  manual binding, and `buildGraphTools(graphDef, moduleRef)` is the single source
  of truth the `ToolNode` builder and the binding providers both use (so the
  model's advertised tools and the executor never drift). New `GraphBoundModel`
  type for annotating the injected token. A graph with no tools returns the model
  unchanged.
- 2a42d42: graph-operations recipes now lead with Nest schematic generate steps (node/tool provider → `nest g provider`, graph definition → `nest g class`) and forbid inlining new nodes/providers/graph-defs into existing files.
- cd21094: Ship a `graph-operations` skill reference for wiring chat models with `@harpua/models` (`references/models.md`), routed from the skill's SKILL.md.

## 0.1.1

### Patch Changes

- 4e6d572: Add the `harpua-skills` CLI. Run it (or set `"prepare": "harpua-skills"`) in a consuming project to link the agent skills shipped by installed `@harpua/*` packages into `.claude/skills` and `.agents/skills`, so Claude Code and Codex discover them automatically. Relative symlinks on POSIX, directory junctions on Windows; idempotent; never clobbers user-owned directories.
