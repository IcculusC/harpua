# harpua-weather-agent

A NestJS 11 + LangGraph **weather agent**, scaffolded with
[`create-harpua-app`](https://www.npmjs.com/package/create-harpua-app) and built
on [`@harpua/langgraph`](https://www.npmjs.com/package/@harpua/langgraph).

It's the classic LangGraph weather-agent quickstart, made runnable the idiomatic
Nest way: the tool is a method on a DI provider, the model call is a node, and
the edges are a typed list. A `get_weather` tool calls the keyless
[Open-Meteo](https://open-meteo.com) API; a `think` tool lets the agent reason
between steps.

## Quickstart

```bash
pnpm install     # also links agent skills via the prepare script (see below)
pnpm start:dev   # boot the API on :3000
```

```bash
curl -XPOST localhost:3000/agent/t1 -H 'content-type: application/json' \
  -d '{"message":"what is the weather in berlin?"}'
# -> {"messages":["It's currently 21.3°C and clear sky in Berlin, Germany."]}
```

Prefer a terminal REPL?

```bash
pnpm chat
weather> what's the weather in Tokyo?
```

Run the tests (deterministic, offline):

```bash
pnpm test
```

## Choosing a model — `MODEL_PROVIDER`

The chat model comes from [`@harpua/models`](https://www.npmjs.com/package/@harpua/models),
wired in `agent.module.ts` via `ChatModelModule.forRoot(...)`. It boots on a mock
by default and goes real with one env flip — validated with zod, so a
misconfiguration fails fast with a precise message. Copy `.env.example` to `.env`
and set the values.

**Mock to boot, OpenRouter to go real.** OpenRouter is the expected path for a
real model: one API key, hundreds of models (many cheap, several free).

| `MODEL_PROVIDER` | Model | Required env | Notes |
|---|---|---|---|
| `openrouter` **(recommended real arm)** | `ChatOpenRouter` (`@langchain/openrouter`) | `OPENROUTER_MODEL`, `OPENROUTER_API_KEY` | One key, every model — cheap/free options like `meta-llama/llama-3.1-8b-instruct`. Try `anthropic/claude-sonnet-4.5`. |
| `mock` (default) | in-project `MockChatModel` | — | Deterministic, offline. Still calls the **real** Open-Meteo API for weather. |
| `ollama` | `ChatOllama` (`@langchain/ollama`) | `OLLAMA_MODEL` (`OLLAMA_BASE_URL` optional) | Local Ollama daemon. No API key. |
| `openai-compatible` | `ChatOpenAI` (`@langchain/openai`) | **`OPENAI_COMPATIBLE_BASE_URL`**, `OPENAI_COMPATIBLE_MODEL` (`OPENAI_COMPATIBLE_API_KEY` optional) | Any OpenAI-compatible server (vLLM, LM Studio, Together, …). |

Go real in one line:

```bash
MODEL_PROVIDER=openrouter OPENROUTER_API_KEY=sk-or-... \
  OPENROUTER_MODEL=anthropic/claude-sonnet-4.5 pnpm start
```

All three real arms ship as optional peers; install only what you use (this
template pre-installs all three).

### Named roles (one key, many models)

`agent.module.ts` registers three example roles alongside the default —
injectable with `@InjectChatModel("fast" | "smart" | "tools")`. Each has an
**arm-scoped** OpenRouter model preset, so with no env they all boot on the mock
arm (keyless boot intact); one prefixed var flips a role real with the id already
applied, all sharing a single `OPENROUTER_API_KEY`:

| Role | Preset OpenRouter model | Approx input price¹ |
|---|---|---|
| `fast` | `deepseek/deepseek-v4-flash` | ≈ $0.09 / M tokens |
| `smart` | `deepseek/deepseek-v4-pro` | ≈ $0.44 / M tokens |
| `tools` | `openai/gpt-oss-120b` | ≈ $0.03 / M tokens |

¹ Cheap enough to play freely. Prices as of 2026-07-07, subject to drift.

```bash
FAST_MODEL_PROVIDER=openrouter
SMART_MODEL_PROVIDER=openrouter
TOOLS_MODEL_PROVIDER=openrouter
OPENROUTER_API_KEY=sk-or-...   # one shared key covers all three
```

See the `@harpua/models` README for the full `register()` / env-prefix contract.

## What the mock does

`MockChatModel` (in `src/agent/mock-chat-model.ts`) is a genuine `BaseChatModel`
with no network of its own — runtime code shouldn't depend on a testing library,
so it lives in the project. It's scripted:

1. A human turn matching **"weather … in `<place>`"** → emits a `get_weather`
   tool call for the captured location.
2. A tool result present → summarizes it into the reply. So **mock mode still
   makes the real Open-Meteo call** — you get live weather without any model key.
3. Otherwise → help text listing what the agent can do.

When you teach the mock a new capability, update its help text too. The mock is
wired as the `mock` arm's factory (`ChatModelModule.forRoot({ defaults: { mockModel } })`
in `agent.module.ts`), so `MODEL_PROVIDER=mock` (the default) uses this scripted
weather model rather than the generic echo mock built into `@harpua/models`.

## Agent skills

This project depends on `@harpua/*` packages that ship
[agentskills.io](https://agentskills.io)-format skills (recipes for adding tools,
nodes, graphs, …). The `prepare` script runs `harpua-skills` on every install,
which links those skills into `.claude/skills` and `.agents/skills` so Claude
Code and Codex discover them automatically. Run it ad hoc any time with
`pnpm exec harpua-skills`.

## Project layout

```
src/
  main.ts                     # HTTP bootstrap (POST /agent/:threadId)
  cli.ts                      # readline REPL surface
  app.module.ts               # root module + memory checkpointer
  agent/
    weather-agent.graph.ts    # state, CallModelNode, shouldContinue, the graph
    weather.tools.ts          # get_weather (Open-Meteo), fetch injected via DI
    mock-chat-model.ts        # deterministic offline model (the mock arm's factory)
    fetch.token.ts            # injectable fetch (default: globalThis.fetch)
    agent.service.ts          # invokes the compiled graph facade
    agent.controller.ts       # HTTP endpoint
    agent.module.ts           # wiring
```
