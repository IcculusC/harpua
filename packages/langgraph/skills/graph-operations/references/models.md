# Wiring chat models with @harpua/models

Provide chat models to a Nest app by named registration, env-driven, with every
LangChain integration an optional peer. **Mock to boot instantly, OpenRouter to
go real** (one key, every model). Install: `pnpm add @harpua/models`, then add
only the arm you use (`@langchain/openrouter` recommended, or `@langchain/ollama`
/ `@langchain/openai`).

## GO-LIVE CHECKLIST — mock is a boot convenience, NOT a finished setup

If you are the agent standing up this app: the mock arm makes everything boot
and answer on empty env, which means "it runs" proves NOTHING about being
live. A setup is not complete until a REAL provider answered. Before you
report setup done:

1. **Ask the human for their OpenRouter key** (openrouter.ai/keys — one key,
   every model). NEVER invent, hardcode, or commit a key; it goes in the
   app's untracked env (`.env`, shell profile — whatever this app uses).
2. Set the go-live env (see the next section for the exact vars):
   `MODEL_PROVIDER=openrouter`, `OPENROUTER_API_KEY`, `OPENROUTER_MODEL`.
3. Boot and drive ONE real completion end-to-end (the app's chat endpoint or
   CLI). The boot log prints the active arm per model — `model "default" ->
   openrouter (…)`. If it says `mock`, you are not live.
4. Confirm the reply is a real completion, not the built-in echo mock
   parroting the input back.

If the human has no key yet, say so explicitly in your handoff — "boots on
the mock arm; NOT live until OPENROUTER_API_KEY is set" — instead of letting
a green boot imply a finished setup.

## Register + inject

```ts
// app.module.ts — forRoot registers the DEFAULT model (token CHAT_MODEL).
imports: [ChatModelModule.forRoot()],
```

```ts
// A node/service injects it — no arg = default model.
constructor(@InjectChatModel() private readonly model: BaseChatModel) {}
```

The mock arm is the zero-config default: an app boots and answers on empty env,
no key and no optional peer. Do NOT hand-roll a `CHAT_MODEL` factory provider —
that is exactly what this package replaces.

## Go real with OpenRouter (the expected path)

Three env vars, no code change:

```bash
MODEL_PROVIDER=openrouter
OPENROUTER_API_KEY=sk-or-...
OPENROUTER_MODEL=anthropic/claude-sonnet-4.5   # cheap/free options exist too
```

## Named models & roles

Register more models; each reads a SCREAMING_SNAKE env prefix and is injected by
name. `forRoot()` is REQUIRED before any `register()`, and names are unique —
both enforced at bootstrap. Names are lowercase slugs (`/^[a-z][a-z0-9-]*$/`).

Preset a role's model id **arm-scoped** (`defaults.openrouter.model`) so it still
boots keyless: with no env the role is on the mock arm; one prefixed var flips it
real with the id already applied. Never flat `defaults.model` — a slug is
coherent only within its own arm.

```ts
imports: [
  ChatModelModule.forRoot(),
  ChatModelModule.register({
    name: "fast",
    defaults: { openrouter: { model: "deepseek/deepseek-v4-flash" } },
  }),
  ChatModelModule.register({
    name: "smart",
    defaults: { openrouter: { model: "deepseek/deepseek-v4-pro" } },
  }),
],
```

### Multi-upstream roulette: pin the reasoning channel (and the upstreams)

OpenRouter routes one model id across upstream instances that do NOT agree
about the reasoning channel. When a call lands on one serving it without the
channel, the model thinks IN CONTENT — 11KB think-vomit replies, foreign-
language filler, empty finals, even raw DSML tool-call markup rendered to the
user. Two levers, both arm-scoped defaults:

```ts
defaults: {
  openrouter: {
    model: "deepseek/deepseek-v4-flash",
    // Every upstream serves the reasoning channel; exclude keeps it off the
    // wire coming back (don't pay for/see it). Rides the request body.
    reasoning: { enabled: true, exclude: true },
    // And/or pin the routing itself — allow/deny/order specific upstreams:
    provider: { order: ["deepseek"], allow_fallbacks: false },
  },
},
```

`modelKwargs: { ... }` is the generic escape hatch for OpenRouter request
params the schema doesn't name (`reasoning` wins on key collision). Reserved
keys that would shadow first-class params (`model`, `tools`, `tool_choice`,
`provider`, `models`) are rejected at boot — the lib spreads modelKwargs last,
so they'd silently win otherwise.

```bash
FAST_MODEL_PROVIDER=openrouter   # flips "fast" real; model preset; shares OPENROUTER_API_KEY
```

```ts
constructor(@InjectChatModel("fast") private readonly fast: BaseChatModel) {}
```

## Per-call model routing (swap a named role for ONE model call)

Use the strong arm only for the calls that need it (e.g. the turn where a
middleware injected RAG excerpts) and keep the cheap default for the tool
loop. Three pieces, all existing exports — do NOT hand-roll a provider:

1. **Bind the role with the graph's tools** in the graph's `forFeature`
   scope (a raw role model can't emit the graph's tool calls;
   `ModelRequest.withModel` wants an already-BOUND model):

```ts
const SMART_BOUND = Symbol("agent:SMART_BOUND");

LangGraphModule.forFeature([SupportAgent], {
  providers: [
    provideGraphBoundModel({
      provide: SMART_BOUND,
      graph: SupportAgent,
      model: getChatModelToken("smart"),
    }),
    RoutingMiddleware,
  ],
})
```

2. **Swap per call** in a `wrapModelCall` middleware via `req.withModel`:

```ts
@LangGraphMiddleware()
export class RoutingMiddleware implements LangGraphMiddlewareContract {
  constructor(@Inject(SMART_BOUND) private readonly smart: GraphBoundModel) {}

  wrapModelCall(req: ModelRequest<any>, next: ModelNext) {
    return needsSmartArm(req) ? next(req.withModel(this.smart)) : next(req);
  }
}
```

3. **Scope gotcha:** the middleware injecting the bound token must be
   instantiated in the SAME `forFeature` scope where the token is provided
   (see the middleware DI gotcha in `agents-and-middleware.md`).

If the role token resolves to null (e.g. its factory returns null in that
scope), `provideGraphBoundModel` throws a named error at boot rather than a
`bindTools` TypeError at first use.

## Env reference (`<P>` = prefix: empty for default, `FAST_`, …)

| Arm | Variables | Required? |
|---|---|---|
| `openrouter` (recommended) | `<P>OPENROUTER_MODEL`; `<P>OPENROUTER_API_KEY` (opt — lib reads `OPENROUTER_API_KEY` too) | model required¹ |
| `mock` (default) | — | none |
| `ollama` | `<P>OLLAMA_MODEL`; `<P>OLLAMA_BASE_URL` (opt, default `http://localhost:11434`) | model required¹ |
| `openai-compatible` | `<P>OPENAI_COMPATIBLE_BASE_URL`, `<P>OPENAI_COMPATIBLE_MODEL`; `<P>OPENAI_COMPATIBLE_API_KEY` (opt) | base url + model required² |

¹ unless the arm-scoped default (e.g. `defaults.openrouter.model`). ² base url
unless `defaults.openaiCompatible.baseUrl`. Precedence is
**env > defaults > error**; an unknown `MODEL_PROVIDER` fails fast naming the
valid arms; a missing optional peer fails with a `pnpm add` hint. No default
model IDs are ever guessed.

## OpenRouter extras + mock override (via `defaults`)

`forRoot`/`register` take `defaults` (code fallbacks env overrides):

```ts
ChatModelModule.register({
  name: "smart",
  defaults: {
    temperature: 0.2,
    openrouter: {
      siteUrl: "https://myapp.com",   // HTTP-Referer attribution
      siteName: "My App",             // X-Title attribution
      provider: { order: ["anthropic"] }, // routing prefs (passthrough)
      models: ["anthropic/claude-sonnet-4.5", "openai/gpt-4o-mini"], // routing fallback
    },
  },
});
```

`defaults.mockModel: () => BaseChatModel` replaces the built-in echo mock for the
`mock` arm — the way a demo keeps a scripted offline model while staying
mock-by-default (e.g. `forRoot({ defaults: { mockModel: () => new MyMock() } })`).
Runtime code stays free of any testing-library dependency.

`defaults` entries compose: when adding `provider` or an arm-scoped preset,
KEEP the existing `mockModel` line. Deleting it while switching arms silently
reverts tests and keyless boots to the built-in echo — a known foot-gun.
