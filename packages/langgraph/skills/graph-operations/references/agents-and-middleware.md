# Agents and middleware

For a **model↔tools agent loop**, the toolkit ships a first-class preset and a middleware system, so you don't have to assemble the loop — or the turn counters, try/catch retries, and message trimming — by hand.

- **`@LangGraphAgent`** — a declarative model↔tools loop that lowers to the same primitives you'd hand-write (generated `CallModel` node, `TOOLS` node, conditional-edge loop) and is fully **ejectable**.
- **`@LangGraphMiddleware`** — cross-cutting behavior (turn/token/wall caps, retries, history trimming, early-exit, logging) added as DI-provider middleware, not baked into a node.

## Generate the pieces
- Agent class: `nest g class <name>.agent --flat` (it's a decorated class, like a graph def).
- Custom middleware: `nest g provider <name>.middleware --flat` (middleware ARE `@Injectable` providers).

## The agent

```ts
@LangGraphAgent({
  name: "support",
  state: new StateSchema({ messages: MessagesValue }), // the reserved loop/exit channels are merged in for you
  model: CHAT_MODEL,           // a BASE BaseChatModel token; tools are bound to it automatically
  tools: [OrderTools],         // ToolEntry[] — providers or raw tools
  middleware: [BudgetMiddleware, RetryMiddleware], // array order = onion, first = outermost
  responseFormat: MyOutcomeSchema, // optional zod schema → a typed `state.outcome` channel
})
export class SupportAgent {}
```
Inject the compiled runnable with `@InjectLangGraphRunnable(SupportAgent)`. See `references/models.md` for the `model:` token.

## Cap turns / avoid `GraphRecursionError`, and retry model calls — use the shipped middleware
Don't count `AIMessage`s yourself and don't wrap `invoke` in try/catch. Use:
- **`provideBudget({ maxCycles, maxToolCalls, maxTokens, maxWallMs, reset })`** — a graceful guard that ends the loop at the canonical exit when any cap is hit, instead of throwing `GraphRecursionError`. `reset` defaults to `"invoke"` (caps are per-invoke); pass `reset: "thread"` for a lifetime ceiling — see [Semantics](#semantics-loopexit-reset-per-invoke-by-default).
- **`provideRetry({ maxRetries, retryable, backoff })`** — retries the model AND tool calls with a shared, injectable backoff (inject a no-op backoff in tests).

List the classes in `middleware: [...]` and register their options in **`forFeature`'s `{ providers }`** (see the DI gotcha):
```ts
LangGraphModule.forFeature([SupportAgent], {
  providers: [
    ...provideBudget({ maxCycles: 3, maxToolCalls: 20, maxTokens: 100_000, maxWallMs: 60_000 }),
    ...provideRetry({ maxRetries: 1, retryable: () => true, backoff: async () => {} }),
  ],
})
```

## Writing a custom middleware
```ts
import {
  LangGraphMiddleware,               // the DECORATOR (a value)
  type LangGraphMiddlewareContract,  // the INTERFACE (a type) — NOTE the different name
  type MiddlewareContext,
} from "@harpua/langgraph";

@LangGraphMiddleware()
export class KeywordStopMiddleware implements LangGraphMiddlewareContract {
  constructor(@Inject(KEYWORD_STOP_OPTS) private readonly opts: KeywordStopOptions) {}

  // NODE hook — runs as an inserted graph node; returns a state patch, or ctx.exit()
  afterModel(ctx: MiddlewareContext<any>): Partial<any> | void {
    const last = ctx.state.messages.at(-1);
    if (isAIMessage(last) && String(last.content).includes(this.opts.stopWord)) {
      return ctx.exit({ reason: "keyword" }); // ← how you stop the loop early
    }
  }
}

export function provideKeywordStop(opts: KeywordStopOptions): Provider[] {
  return [{ provide: KEYWORD_STOP_OPTS, useValue: KeywordStopOptions.parse(opts) }, KeywordStopMiddleware];
}
```

### The two hook kinds
| Hook kind | Methods | Signature | Use for |
|---|---|---|---|
| **Node hook** | `beforeAgent` / `beforeModel` / `afterModel` / `afterAgent` | `(ctx: MiddlewareContext) => Partial<State> \| void` | reading `ctx.loop`, patching state, **stopping the loop (`ctx.exit()`)** |
| **Wrap hook** | `wrapModelCall` / `wrapToolCall` | `(request, next) => response` | intercepting the call: mutate `request`, retry (`next` N times), or decline (`next` 0 times) |

`MiddlewareContext` gives `state` (readonly), `loop` (`{ iteration, modelCalls, toolCalls, tokens, startedAt }`), `config`, `now()` (injected clock), `interrupt(payload)`, and `exit(meta)`.

## Good to know (the things that trip people up)
- **Stopping the loop:** `ctx.exit(meta)` from a node hook flips a reserved `exit` state flag that the loop's conditional edges route on. Prefer it over `throw`ing or returning a LangGraph `Command({goto})` — a `Command` goto is *additive* with the node's static edge, so it won't short-circuit the loop.
- **Trimming / compacting history:** do it in a `wrapModelCall`, not a node. The `messages` channel is append-only (`MessagesValue` reducer), so a node returning `{ messages: trimmed }` would *append*, not replace. In a wrap hook you change only the per-call request — `return next({ ...req, messages: trimmed })` — so the model sees fewer messages this turn while the persisted transcript stays intact. (`systemPrompt` sugar lowers to exactly such a wrap for the same reason.)
- **Middleware option providers** belong in `forFeature([Agent], { providers: [...] })`, not the app module's top-level `providers`. The middleware classes are DI-registered inside the agent's feature-module scope; a registration at the app root is a different scope the agent's generated nodes can't see, so `@Inject(...OPTS)` won't resolve at boot.
- **Two names:** the decorator is `LangGraphMiddleware`; the hook interface is `LangGraphMiddlewareContract` (a TS `isolatedModules` constraint blocks the same name for both).
- **`{ use, on }` node-scoping** isn't in v1 — list the middleware class directly; the compiler rejects the `{ use, on }` form.

## `responseFormat` → typed `outcome`
Set `responseFormat: <zod schema>` and a `StructuredResponseNode` coerces the final answer into `state.outcome` (a typed channel an outer graph can `route()` on). A `Budget`-forced stop routes through the same node, so even a graceful give-up yields a typed outcome.

## Semantics: `loop`/`exit` reset per invoke by default
The reserved `loop` counters and the `exit` flag are **persisted** (LastValue), so nothing resets them on its own — something has to, and `BudgetMiddleware` is what does.

- **`reset: "invoke"` (the default):** `provideBudget`'s `beforeAgent` hook zeroes `loop` and clears `exit` at the start of every invoke. Caps are **per-invoke**, and a thread that exited last turn starts the next one clean. This is what you want for a chat thread.
- **`reset: "thread"`:** counters accumulate over the thread's whole lifetime (a hard spend ceiling), and a thread whose agent has exited **stays exited** on re-invoke — clear it with `clearAgentExit()` + `graph.updateState`, or start a new `thread_id`.

With no `provideBudget` at all, nothing manages these channels: they accumulate like `reset: "thread"`.

## Testing an agent whose middleware needs DI options
`createGraphTestingModule` (in `@harpua/langgraph-testing`) does not forward a `providers` option into `forFeature`'s scope, so it cannot wire middleware options. Boot the agent directly instead:
```ts
const moduleRef = await Test.createTestingModule({
  imports: [
    LangGraphModule.forRoot(),
    LangGraphModule.forFeature([SupportAgent], { providers: [...provideBudget({ maxCycles: 2, /* … */ }), { provide: CHAT_MODEL, useClass: ScriptedModel }] }),
  ],
}).compile();
```
Drive it with a local scripted `BaseChatModel` (the `@harpua/langgraph` package cannot depend on `@harpua/langgraph-testing`); see `references/testing.md` and the package's own `agent-middleware.integration.spec.ts` for the pattern.

## Ejecting
`@LangGraphAgent` lowers to a plain `@LangGraph` with an explicit `defineEdges`, a generated-but-real `CallModel` node, and the conditional-edge loop. To interleave custom nodes inside the loop or hand-edit the topology, eject to that explicit form (see `references/graph.md`).
