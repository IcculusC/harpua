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

The chat model is selected at boot by the `MODEL_PROVIDER` env var and validated
with zod (a misconfiguration fails fast with a precise message). Copy
`.env.example` to `.env` and set the values.

| `MODEL_PROVIDER` | Model | Required env | Notes |
|---|---|---|---|
| `mock` (default) | in-project `MockChatModel` | — | Deterministic, offline. Still calls the **real** Open-Meteo API for weather. |
| `ollama` | `ChatOllama` (`@langchain/ollama`) | `OLLAMA_MODEL`, `OLLAMA_BASE_URL` | Needs a running Ollama daemon. No API key. |
| `openai-compatible` | `ChatOpenAI` (`@langchain/openai`) | **`OPENAI_COMPATIBLE_BASE_URL`**, `OPENAI_COMPATIBLE_MODEL`, `OPENAI_COMPATIBLE_API_KEY` | Any OpenAI-compatible server (OpenAI, vLLM, LM Studio, Together, …). |

### Adding an Anthropic (Claude) arm

Kept out of the box to keep the install lean. To add it, install the package and
extend the factory:

```bash
pnpm add @langchain/anthropic
```

```ts
// src/agent/chat-model.provider.ts
import { ChatAnthropic } from "@langchain/anthropic";

// 1. add "anthropic" to the MODEL_PROVIDER enum
// 2. add ANTHROPIC_API_KEY / ANTHROPIC_MODEL to envSchema (require the key in superRefine)
// 3. add the arm:
case "anthropic":
  logProvider(`anthropic (${env.ANTHROPIC_MODEL})`);
  return new ChatAnthropic({
    model: env.ANTHROPIC_MODEL,
    apiKey: env.ANTHROPIC_API_KEY,
  });
```

## What the mock does

`MockChatModel` (in `src/agent/mock-chat-model.ts`) is a genuine `BaseChatModel`
with no network of its own — runtime code shouldn't depend on a testing library,
so it lives in the project. It's scripted:

1. A human turn matching **"weather … in `<place>`"** → emits a `get_weather`
   tool call for the captured location.
2. A tool result present → summarizes it into the reply. So **mock mode still
   makes the real Open-Meteo call** — you get live weather without any model key.
3. Otherwise → help text listing what the agent can do.

When you teach the mock a new capability, update its help text too.

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
    chat-model.provider.ts    # MODEL_PROVIDER factory (mock | ollama | openai-compatible)
    mock-chat-model.ts        # deterministic offline model
    fetch.token.ts            # injectable fetch (default: globalThis.fetch)
    agent.service.ts          # invokes the compiled graph facade
    agent.controller.ts       # HTTP endpoint
    agent.module.ts           # wiring
```
