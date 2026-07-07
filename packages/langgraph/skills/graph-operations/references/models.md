# Wiring chat models with @harpua/models

Provide chat models to a Nest app by named registration, env-driven, with every
LangChain integration an optional peer. **Mock to boot instantly, OpenRouter to
go real** (one key, every model). Install: `pnpm add @harpua/models`, then add
only the arm you use (`@langchain/openrouter` recommended, or `@langchain/ollama`
/ `@langchain/openai`).

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

```bash
FAST_MODEL_PROVIDER=openrouter   # flips "fast" real; model preset; shares OPENROUTER_API_KEY
```

```ts
constructor(@InjectChatModel("fast") private readonly fast: BaseChatModel) {}
```

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
