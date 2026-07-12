# @harpua/langgraph

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
