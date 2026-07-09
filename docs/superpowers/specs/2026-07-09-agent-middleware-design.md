# Agent loop + middleware for `@harpua/langgraph` — design

**Status:** Design approved (2026-07-09). **Implementation DEFERRED** until `feat/knowledge-tools` (the on-disk RAG work) lands on `main` and the maintainer explicitly greenlights the build. This document is the spec only — no implementation plan is authored yet.

## Motivation

LangChain v1's `createAgent` introduced *middleware* — hooks (`beforeModel`, `afterModel`, `wrapModelCall`, `wrapToolCall`, `beforeAgent`, `afterAgent`) that get compiled into an underlying LangGraph as nodes. Good idea, executed in a way we can improve on:

- Their middleware are plain objects, so injecting services (a retriever, a rate limiter, config, a repository) is awkward glue.
- `@harpua/langgraph` already models nodes as DI providers and tools as provider methods — so a middleware is naturally *another provider*, and gets the Nest container for free. That's the structural win LangChain can't cleanly reach.

Separately, building the agentic loop (model↔tools) in `@harpua/langgraph` today is manual boilerplate: a hand-written `CallModel` node, the `TOOLS` node, and the loop edges, repeated per agent. We want a first-class, declarative way to instantiate that loop — *without* abandoning the toolkit's "explicit edge lists, no magic" DNA.

## Goals (v1)

- A **middleware** abstraction: DI-provider middleware with node hooks and callable-wrap hooks.
- A first-class **`@LangGraphAgent`** preset for the model↔tools loop that is **declarative but lowers transparently** to the same primitives you'd hand-write — ejectable and addressable, not a black box.
- Two reference middlewares that exercise both mechanisms end-to-end: **Budget** (node/loop-guard) and **Retry** (callable-wrap, model + tool).
- `responseFormat` for a typed terminal outcome.

## Non-goals (v1)

- **No LangChain-middleware interop.** We own the behavior and aren't beholden to their evolving API.
- **No HIL migration.** The shipped approval-gate API (`requireApproval`, `@LangGraphTool({ requiresApproval })`) stays as-is. HIL serves as the *paper-witness* that pins the wrap contract; migrating it onto the middleware API is a follow-up.
- **No full middleware wave.** Compaction, ModelSelect, and RAG/CAG middlewares are follow-up specs once the substrate is proven.

## Architecture — two mechanisms

Middleware come in two kinds, distinguished by how they lower:

1. **Node hooks** — `beforeAgent`, `beforeModel`, `afterModel`, `afterAgent` (and before/after any named node). These become **real inserted graph nodes** with conditional edges.
2. **Callable-wrap hooks** — `wrapModelCall`, `wrapToolCall`. These are **not nodes**; they compose as wrappers around a callable, reusing two seams that already exist:
   - `wrapToolCall` layers onto the OpenTelemetry tool proxy (`instrumentRawTool`) that already wraps every tool at compile.
   - `wrapModelCall` layers onto `provideGraphBoundModel`, which already produces the bound model.
   Because they wrap the callable *in place*, they are **topology-independent** — they work whether tools live in one `ToolNode` or several, and in any graph, not just the agent preset. This is what dissolves the "wrapToolCall is fuzzy in a general graph" problem.

A middleware is conceptually **`(hook, target)`**: the target is a node ref or a callable. Loop hooks auto-target the preset's model node / tool callables; node hooks can target any node ref, generated or hand-written.

## The middleware contract

A middleware is a DI provider:

```ts
@LangGraphMiddleware()
export class ExampleMiddleware {
  constructor(private readonly svc: SomeService) {} // DI — the point

  // NODE hooks → inserted nodes
  beforeAgent?(ctx: MiddlewareContext<S>): Promise<Partial<S> | void>;
  beforeModel?(ctx: MiddlewareContext<S>): Promise<Partial<S> | Command | void>;
  afterModel?(ctx: MiddlewareContext<S>): Promise<Partial<S> | void>;
  afterAgent?(ctx: MiddlewareContext<S>): Promise<Partial<S> | void>;

  // CALLABLE-wrap hooks → composed wrappers
  wrapModelCall?(req: ModelRequest<S>, next: ModelNext): Promise<AIMessage>;
  wrapToolCall?(call: ToolRequest<S>, next: ToolNext): Promise<ToolMessage>;
}
```

**Node-hook context** — `MiddlewareContext<S> = { state: Readonly<S>; loop: LoopInfo; config: RunnableConfig; now(): number; interrupt(payload): Promise<unknown>; exit(meta?): Command }`. A node hook returns a **state patch** or a **`Command`** (route / short-circuit). `exit()` is a preset-provided helper that routes to the loop's *canonical exit* — the `StructuredResponseNode` if `responseFormat` is set, otherwise `END`. `now()` is an injected clock (no bare `new Date()` in logic under test).

**Wrap-hook contract** — `(request, next) => response`, with three non-negotiable powers:

- `request` is **mutable** (or you pass a modified copy to `next`) — for CAG (add cache markers) and ModelSelect (swap the model).
- `next` may be called **0..N times** — zero for a synthetic response (HIL decline), N for retry.
- `interrupt()` is **reachable from inside** the wrap — for HIL approval (pause / resume).

Types: `ModelRequest<S> = { messages; model; state: Readonly<S>; …helpers (prependCached, withModel) }`; `ToolRequest<S> = { name; args; id; state: Readonly<S> }`; `ModelNext = (req) => Promise<AIMessage>`; `ToolNext = (call) => Promise<ToolMessage>`.

Those three powers are forced by the four canonical middlewares — the contract is exactly what makes them expressible:

| middleware | uses |
|---|---|
| Retry | `next` ×N |
| CAG | mutate `request`, `next` ×1 |
| ModelSelect | swap `request.model`, `next` ×1 |
| HIL | `interrupt()`, `next` ×0 or ×1 |

**Reserved loop state.** The preset merges a `loop` channel into the agent's state: `{ iteration; modelCalls; toolCalls; tokens; startedAt }` — reducer-backed and **persisted** (survives interrupt/resume and checkpointing). The generated `CallModelNode` / `ToolNode` increment it each cycle; middleware read it via `ctx.loop`. `tokens` is sourced from the model response's `usage_metadata.total_tokens` — which the real arms (OpenRouter / ChatOpenAI / Ollama) emit but `MockChatModel` / the scripted model do not, so `Budget.maxTokens` is untestable in mock mode until the mock emits usage (see Testing). It is an **ordinary channel** — on eject, the increment logic lives in the (now-visible) nodes, fully editable. "Preset-owned" only means the preset writes it *while you use the preset*.

## The `@LangGraphAgent` preset

```ts
@LangGraphAgent({
  state,            // messages-bearing StateSchema; preset merges in `loop`
  model,            // BaseChatModel token (provideGraphBoundModel binds tools)
  tools,            // ToolEntry[] — providers or raw tools
  middleware,       // (Provider | { use: Provider, on: NodeRef })[]
  systemPrompt?,    // string | provider — sugar for a beforeModel prepend
  responseFormat?,  // zod schema → StructuredResponseNode → state.outcome
})
export class SupportAgent {}
```

**Lowering table** (deterministic config → primitives — this mapping is what makes it ejectable rather than magic):

| config | lowers to |
|---|---|
| `model` + `tools` | default `CallModelNode` (invoke bound model, append reply, bump `loop`) + `ToolNode` + the loop edges |
| `middleware` node hooks | inserted nodes (`beforeAgent`/`beforeModel`/`afterModel`/`afterAgent`), ordered by array position |
| `middleware` wrap hooks | composed wrappers on the bound model / each tool (`provideGraphBoundModel` + OTel-proxy seams) — not nodes; nested in array order (first = outermost) |
| `systemPrompt` | a `beforeModel` prepend (sugar), ordered first among `beforeModel` hooks |
| `responseFormat` | appended `StructuredResponseNode` between loop-exit and `END` |
| `state` | + reserved reducer-backed `loop` channel |

**Eject** = the table run by hand: `@LangGraphAgent` → the equivalent `@LangGraph` with an explicit `defineEdges`, every generated node a real editable provider, the loop increments visible in the nodes.

**Compose** — two modes:
- **Nest** — the agent is one node in a larger `@LangGraph`; wire custom edges *around* it. Middleware declared on the agent apply inside it; the parent treats it as one box.
- **Eject-and-inline** — drop to the explicit form and interleave custom nodes *inside* the loop.

**Targeting / ordering** — bare `Provider` for the common case (loop hooks auto-target model/tools). `{ use: Provider, on: NodeRef }` points a middleware at a specific node (custom or generated).

**One ordering rule for both mechanisms: array order = onion, first = outermost.** Earlier in the `middleware` array runs first on the way *in* and last on the way *out*. For node hooks that means the earlier middleware's inserted node runs first. For wrap hooks it means the earlier middleware wraps the later one: `[A, B]` composes to `A.wrap(B.wrap(callable))`, so `A` sees the request first and the response last. This is why `[Retry, ModelSelect]` re-selects the model on every attempt (Retry outer) while `[ModelSelect, Retry]` retries against a fixed model — the array position *is* the control. `systemPrompt` lowers to a `beforeModel` prepend that is ordered **first**, ahead of any user `beforeModel` middleware, so the system message is in place before RAG / compaction / model-select run and user middleware can always see and rewrite around it.

### `responseFormat` → `StructuredResponseNode`

When set, the preset appends a `StructuredResponseNode` at the loop exit. It calls `model.withStructuredOutput(responseFormat).invoke([COERCE_SYSTEM, ...messages])` and writes the parsed value to `state.outcome`, turning a free-form loop into a routable, typed result. Because `Budget.exit()` routes here too, a forced stop still yields a typed outcome (e.g. `{ status: "escalate", reason: "budget" }`) — the runaway case and the honest-give-up case converge on the same node and the same downstream edge. The `outcome` channel is what an *outer* graph's `route()` branches on; the agent doesn't know the downstream nodes, the outer graph doesn't know how the agent decided — the typed channel is the only contract.

## Reference middleware: `Budget` (node / loop-guard)

```ts
@LangGraphMiddleware()
export class BudgetMiddleware {
  // {maxCycles, maxToolCalls, maxTokens, maxWallMs}
  constructor(@Inject(BUDGET_OPTS) private readonly opts: BudgetOptions) {}

  async beforeModel(ctx: MiddlewareContext<S>): Promise<Command | void> {
    const { iteration, toolCalls, tokens, startedAt } = ctx.loop;
    if (
      iteration >= this.opts.maxCycles ||
      toolCalls >= this.opts.maxToolCalls ||
      tokens >= this.opts.maxTokens ||
      ctx.now() - startedAt >= this.opts.maxWallMs
    ) {
      return ctx.exit({ reason: "budget" }); // → the loop's canonical exit
    }
    // else fall through → CallModel runs
  }
}
```

Proves: node insertion, `Command`-based exit, reserved-loop-state read, the graceful-stop → `responseFormat` interplay. `startedAt` is set at `beforeAgent`; the clock is injected via `ctx.now()`.

## Reference middleware: `Retry` (callable-wrap, model + tool)

```ts
@LangGraphMiddleware()
export class RetryMiddleware {
  // {maxRetries, retryable(err), backoff(attempt)}
  constructor(@Inject(RETRY_OPTS) private readonly opts: RetryOptions) {}

  wrapModelCall(req: ModelRequest<S>, next: ModelNext) { return this.withRetry(() => next(req)); }
  wrapToolCall(call: ToolRequest<S>, next: ToolNext)   { return this.withRetry(() => next(call)); }

  private async withRetry<T>(op: () => Promise<T>): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      try { return await op(); }
      catch (err) {
        if (attempt >= this.opts.maxRetries || !this.opts.retryable(err)) throw err;
        await this.opts.backoff(attempt); // injectable delay — no real setTimeout in tests
      }
    }
  }
}
```

Proves: wrap composition on **both** model and tools with `next` called N times — the "smush" (one middleware, both callables, shared logic). `backoff` is injectable for deterministic tests.

Between them, Budget and Retry exercise the entire contract with real consumers. The only two contract powers neither uses — request *mutation* and `interrupt()` — are witnessed on paper by CAG and HIL, so nothing in the API is unaccounted for.

## Testing

Leaning on `@harpua/langgraph-testing`:

- **Unit (middleware alone, no graph)** — Budget: a fabricated `ctx.loop` over/under each cap plus a fake clock, assert `exit()` vs fall-through. Retry: a `next` that throws N times then succeeds plus a no-op `backoff`, assert the attempt count.
- **Lowering** — compile an `@LangGraphAgent`, assert the generated structure matches the eject (generated nodes exist, the `loop` channel is in state, wrap hooks are on the model/tools).
- **Integration (scripted model)** — boot an agent with Budget + Retry, drive it with a scripted model emitting tool calls / failures; assert: budget stops the loop and yields the `escalate: budget` outcome, retry re-invokes on a scripted failure, middleware ordering holds.
- **Eject parity** — the `@LangGraphAgent` and its hand-written eject produce identical behavior on identical input. This keeps "the preset IS the lowered graph" honest.

### `withStructuredOutput` portability

`responseFormat` uses `model.withStructuredOutput`, which the real arms (OpenRouter / ChatOpenAI / Ollama) support but the **`MockChatModel` and the testing scripted-model do not** — so `responseFormat` would break in mock mode *and* be untestable. v1 resolution: keep `withStructuredOutput` as the mechanism (it's the standard) and **extend `MockChatModel` + the scripted-model builder to implement it** (return a scripted / canned structured value). We need this for the integration tests regardless, and it doubles as making `responseFormat` work in mock mode. Document that `responseFormat` requires a structured-output-capable model; a pluggable coercer is a follow-up if anyone hits a model without it.

The **same mock extension** also teaches `MockChatModel` / the scripted model to emit **`usage_metadata`** (a scripted token count per reply). Without it `loop.tokens` stays zero in mock mode and `Budget.maxTokens` can't be exercised — one mock-capability change, two payoffs (`withStructuredOutput` + usage), both on the v1 critical path.

## HIL — paper-witness, not migrated

The shipped approval gate is conceptually a `wrapToolCall` middleware (intercept a tool, pause via `interrupt`, resume). It is **not** migrated in v1 — it's public API since 0.1.3, so migration is a breaking change or a shim. It earns its keep as the *witness* that the wrap contract must support a **0-call short-circuit** (decline → return a synthetic result without executing the tool) and **`interrupt()` from inside a wrap** (approval). Note it is a *callable-wrap*, not a node — that per-tool granularity (only gated tools pause; the rest run in the same turn) is exactly what a node-based gate would lose. Migration onto the middleware API is a follow-up, with a deprecation path.

## RAG / CAG — validate the design, don't build it

RAG (retrieve → inject before the model) is a `beforeModel` middleware; CAG (inject a cached corpus once, marked for provider prompt-caching) is a `beforeAgent` load plus a `wrapModelCall` that mutates the request to stamp cache markers. Both map cleanly onto existing hooks — they **validate** the design and are **not** v1. Two notes:

- There are **two RAGs**, and we already ship one: *agentic* RAG (a `search_knowledge` tool the model decides to call — what the file-exploration and web-research tools already are) vs *middleware* RAG (the framework retrieves deterministically every turn). Complementary; an app wants one per knowledge source.
- **Ship the seam, not a RAG framework.** The toolkit provides the `beforeModel` hook + DI + maybe one thin, configurable `RagMiddleware` that takes a retriever *you* provide. Vector stores / embeddings / rerankers are bring-your-own (optional-peer style, same as checkpointers and model arms). The on-disk RAG work (`feat/knowledge-tools`) becomes one retriever behind a future `RagMiddleware`; the middleware stays retriever-agnostic.

CAG also surfaced a hard requirement already baked into the contract above: `wrapModelCall` must be able to **mutate the outgoing request**, not merely observe it.

## Sequencing

1. **v1 (this spec):** the substrate + `@LangGraphAgent` (with `responseFormat`, loop-state, eject) + **Budget** + **Retry** + the testing-model `withStructuredOutput` support.
2. **Follow-up 1:** migrate HIL onto `wrapToolCall` (deprecate the special-case) — proving the wrap contract subsumes it.
3. **Follow-ups:** `CompactionMiddleware`, `ModelSelectMiddleware`, `RagMiddleware` / `CagMiddleware`.

## Package & conventions

- Everything lands in `@harpua/langgraph` (the `@LangGraphAgent` preset, `@LangGraphMiddleware`, the compiler, the contract types); testing-model additions in `@harpua/langgraph-testing`. Both are publishable → changesets required (a new feature is a **patch** under 0.x semantics; see the `release` skill at implementation time).
- **Zod-first**: the `loop` channel via `StateSchema`; every middleware's options via a zod schema. **One artifact per file** — each middleware, the decorator, the preset compiler, the contract types get their own file. No god files.

## Locked decisions

- v1 scope = substrate + Budget + Retry (not the full wave, not HIL migration, not LC interop).
- Loop bookkeeping lives in **persisted state**, preset-owned, fully ejectable.
- Wrap contract = `(request, next)` with a **mutable request**, `next` callable **0..N**, and `interrupt()` reachable.
- `systemPrompt` is preset **sugar** lowering to a `beforeModel` prepend, ordered first.
- **One ordering rule for node hooks and wrap hooks alike: array order = onion, first = outermost.**
- `responseFormat` uses `withStructuredOutput`; the mock + scripted models are extended to support it **and** to emit `usage_metadata` so `loop.tokens` / `Budget.maxTokens` are testable in mock mode.
- The agent preset is **generated-but-addressable** (default), not opaque; full eject is available.

## Deferred

Implementation waits for `feat/knowledge-tools` to land on `main` (avoids branch collision; the RAG work also informs the future `RagMiddleware`) **and** the maintainer's explicit greenlight. The terminal brainstorming step (writing-plans / implementation) is intentionally **not** taken here.
