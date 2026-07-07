# @harpua/models

Env-driven chat models for NestJS, by named registration. **Boot instantly on a
built-in mock, go real with [OpenRouter](https://openrouter.ai) — one API key,
every model, cheap** (or point at Ollama / any OpenAI-compatible server). Every
LangChain integration is an optional peer, so you install only the arm you use
and an app boots with zero env and zero peers.

- **Mock to boot** — the default arm is a deterministic, offline `MockChatModel`.
  No key, no network, no peer install. Your app runs the moment you wire it.
- **OpenRouter to go real** — flip three env vars and you have Claude, GPT,
  Llama, Gemini, and hundreds more behind a single key. This is the expected
  production path.
- **Named models** — register `fast` and `smart` side by side, each configured
  from its own env prefix. One OpenRouter key, many models.

## Install

```bash
pnpm add @harpua/models
# then install ONLY the arm you use (optional peers):
pnpm add @langchain/openrouter   # OpenRouter — the recommended real arm
# pnpm add @langchain/ollama     # local Ollama
# pnpm add @langchain/openai     # any OpenAI-compatible server
```

`@langchain/core`, `@nestjs/common`, `@nestjs/core`, and `zod` are required
peers you already have in a Nest + LangChain app.

## Quickstart

Register the default model and inject it:

```ts
import { Module } from "@nestjs/common";
import { ChatModelModule } from "@harpua/models";

@Module({
  imports: [ChatModelModule.forRoot()], // default model = env-driven, mock by default
})
export class AppModule {}
```

```ts
import { Injectable } from "@nestjs/common";
import { InjectChatModel } from "@harpua/models";
import { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { HumanMessage } from "@langchain/core/messages";

@Injectable()
export class Assistant {
  constructor(@InjectChatModel() private readonly model: BaseChatModel) {}

  ask(text: string) {
    return this.model.invoke([new HumanMessage(text)]);
  }
}
```

You can also inject the token directly for the simple case:
`@Inject(CHAT_MODEL) model: BaseChatModel`.

### Go real with OpenRouter

With `@langchain/openrouter` installed, three env vars turn the same app into a
real model — no code change:

```bash
MODEL_PROVIDER=openrouter
OPENROUTER_API_KEY=sk-or-...
OPENROUTER_MODEL=anthropic/claude-sonnet-4.5
```

OpenRouter gives you one key for hundreds of models (many cheap, several free —
try `meta-llama/llama-3.1-8b-instruct`). Swap `OPENROUTER_MODEL` to change model.

## Named models

Boot instantly on mock, then register additional models for different jobs. Each
named model reads its own **SCREAMING_SNAKE** env prefix. Here `fast` and `smart`
are two OpenRouter models behind the same key — the one-key-many-models story:

```ts
@Module({
  imports: [
    ChatModelModule.forRoot(), // default (required, before any register())
    ChatModelModule.register({ name: "fast" }), // reads FAST_*
    ChatModelModule.register({ name: "smart" }), // reads SMART_*
  ],
})
export class AppModule {}
```

```bash
# fast: cheap/quick
FAST_MODEL_PROVIDER=openrouter
FAST_OPENROUTER_MODEL=meta-llama/llama-3.1-8b-instruct
# smart: high quality
SMART_MODEL_PROVIDER=openrouter
SMART_OPENROUTER_MODEL=anthropic/claude-sonnet-4.5
# one key covers both (unprefixed OPENROUTER_API_KEY is the fallback)
OPENROUTER_API_KEY=sk-or-...
```

```ts
constructor(
  @InjectChatModel("fast") private readonly fast: BaseChatModel,
  @InjectChatModel("smart") private readonly smart: BaseChatModel,
) {}
```

`ChatModelModule.forRoot()` is **required before any `register()`** and names are
unique — both are enforced at bootstrap with a clear error. Names must be a
lowercase slug matching `/^[a-z][a-z0-9-]*$/` (`fast`, `smart`, `my-model`).

### Env prefix table

| Registration | Prefix | Provider var |
|---|---|---|
| `forRoot()` (default) | *(none)* | `MODEL_PROVIDER` |
| `register({ name: "fast" })` | `FAST_` | `FAST_MODEL_PROVIDER` |
| `register({ name: "smart" })` | `SMART_` | `SMART_MODEL_PROVIDER` |
| `register({ name: "my-model" })` | `MY_MODEL_` | `MY_MODEL_MODEL_PROVIDER` |

## Provider arms & env reference

`MODEL_PROVIDER` (or `<PREFIX>MODEL_PROVIDER`) selects the arm. Unknown values
fail fast at boot naming the valid arms. Precedence is **env > defaults > error**
— nothing is silently guessed, there are no hard-coded default model IDs.

`<P>` below is the empty string for the default model, or `FAST_`, `SMART_`, … for
a named one.

| Arm | Variable | Required? | Notes |
|---|---|---|---|
| **openrouter** (recommended real arm) | `<P>OPENROUTER_MODEL` | yes¹ | e.g. `anthropic/claude-sonnet-4.5` |
| | `<P>OPENROUTER_API_KEY` | no | lib reads `OPENROUTER_API_KEY` itself; ours overrides when set |
| **mock** (default) | — | — | zero-config, offline, deterministic |
| **ollama** | `<P>OLLAMA_MODEL` | yes¹ | e.g. `llama3.1` |
| | `<P>OLLAMA_BASE_URL` | no | defaults to `http://localhost:11434` |
| **openai-compatible** | `<P>OPENAI_COMPATIBLE_BASE_URL` | yes² | e.g. `http://localhost:1234/v1` |
| | `<P>OPENAI_COMPATIBLE_MODEL` | yes¹ | the served model id |
| | `<P>OPENAI_COMPATIBLE_API_KEY` | no | placeholder `not-needed` for keyless local servers |

¹ Required unless supplied via the arm-scoped default (e.g.
`defaults.openrouter.model`). ² Required unless via
`defaults.openaiCompatible.baseUrl`.

### OpenRouter extras

Hard-code attribution and routing per registration via `defaults.openrouter`:

```ts
ChatModelModule.register({
  name: "smart",
  defaults: {
    openrouter: {
      siteUrl: "https://myapp.com", // HTTP-Referer attribution
      siteName: "My App", // X-Title attribution
      provider: { order: ["anthropic"], allow_fallbacks: true }, // routing prefs
      models: ["anthropic/claude-sonnet-4.5", "openai/gpt-4o-mini"], // routing fallback
    },
  },
});
```

## Defaults

`forRoot`/`register` accept `defaults` — code-level fallbacks that env overrides:

```ts
interface ModelDefaults {
  // Cross-cutting:
  provider?: "mock" | "openrouter" | "ollama" | "openai-compatible";
  temperature?: number;
  mockModel?: () => BaseChatModel; // replaces the built-in mock for the mock arm
  // Arm-scoped — a model id is coherent only within its own arm, and a preset
  // here never forces a client at boot (the arm is chosen by provider/env):
  openrouter?: {
    model?: string; // e.g. "deepseek/deepseek-v4-flash"
    apiKey?: string;
    siteUrl?: string;
    siteName?: string;
    provider?: Record<string, unknown>; // OpenRouter ProviderPreferences
    models?: string[];
  };
  ollama?: { model?: string; baseUrl?: string };
  openaiCompatible?: { model?: string; baseUrl?: string; apiKey?: string };
}
```

### Roles: preset models that still boot keyless

Register roles whose model id is preset per arm. Because the preset is
arm-scoped, every role boots on the mock arm with zero env — then a single
prefixed var flips one real with the id already applied:

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
  ChatModelModule.register({
    name: "tools",
    defaults: { openrouter: { model: "openai/gpt-oss-120b" } },
  }),
],
```

```bash
# One env var flips a role real; the model id is already preset. One shared key.
FAST_MODEL_PROVIDER=openrouter
SMART_MODEL_PROVIDER=openrouter
TOOLS_MODEL_PROVIDER=openrouter
OPENROUTER_API_KEY=sk-or-...
```

```ts
constructor(@InjectChatModel("smart") private readonly smart: BaseChatModel) {}
```

## Mock behavior & the `mockModel` override

The built-in `MockChatModel` is the default arm: a real `BaseChatModel` that
makes no network calls, emits no tool calls, and returns a deterministic echo
tagged with the registration name — `"[mock:default] you said: <your text>"`. It
requires no key and no optional peer, so an app boots and answers on empty env.
Because the echo is deterministic, `defaults.temperature` is **ignored by the
mock arm** — it applies only to the real arms.

For demos or tests that need scripted behavior (routing to tools, canned
replies), supply your own model via `defaults.mockModel`. It wins over the
built-in mock whenever the resolved provider is `mock`:

```ts
ChatModelModule.forRoot({
  defaults: { mockModel: () => new MyScriptedModel() },
});
```

This keeps runtime code free of any testing-library dependency while letting the
app stay mock-by-default.

## Testing

`ChatModelModule.forRoot()` configures the default model **once per process** —
calling it a second time throws. A single app boots it once, so nothing special
is needed. But a test suite that boots more than one app in the same process
(e.g. spinning up several NestJS modules across `describe` blocks) must reset the
process-wide registry between boots:

```ts
import { resetChatModelRegistry } from "@harpua/models";

beforeEach(() => resetChatModelRegistry());
```

This clears the "default model registered" flag and any named registrations so
the next `forRoot()` starts from a clean slate. It exists solely for test
isolation.
