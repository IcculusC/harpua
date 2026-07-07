# create-harpua-app

Scaffold a runnable NestJS + LangGraph **weather agent** built on
[`@harpua/langgraph`](https://www.npmjs.com/package/@harpua/langgraph) in one
command.

```bash
pnpm create harpua-app my-agent
# or: npm create harpua-app@latest my-agent
# or: npx create-harpua-app my-agent
```

Then:

```bash
cd my-agent
pnpm install       # links the agent skills via the prepare script
pnpm start:dev     # boot the API on :3000
```

```bash
curl -XPOST localhost:3000/agent/t1 -H 'content-type: application/json' \
  -d '{"message":"what is the weather in berlin?"}'
```

## What you get

A minimal, complete NestJS 11 project — the LangGraph weather-agent quickstart
made runnable the idiomatic `@harpua/langgraph` way:

- A **`get_weather` tool** (`WeatherTools`) that calls the keyless
  [Open-Meteo](https://open-meteo.com) geocoding + forecast APIs, with the
  `fetch` implementation injected via DI (so tests supply a fake) and both API
  responses parsed with zod.
- The prebuilt **`thinkTool()`** from
  [`@harpua/agent-tools`](https://www.npmjs.com/package/@harpua/agent-tools),
  mounted raw in the same graph — demonstrating mixed provider-class and
  raw-instance tools.
- A **ReAct-style graph**: `CallModelNode` → route → `TOOLS` | `END` loop, with
  a memory checkpointer.
- A **pluggable chat model** selected by `MODEL_PROVIDER` (see below), defaulting
  to a deterministic in-project **mock** so the app runs offline out of the box.
- An HTTP surface (`POST /agent/:threadId`) and a thin **CLI REPL**
  (`pnpm chat`).
- **Deterministic, offline tests** for the tool loop and the weather tool.
- Self-contained TypeScript / ESLint / Jest config and a GitHub Actions CI
  workflow — no build tooling to wire up.

## The scaffolder

The bin copies the embedded `template/` directory, names the project after your
target directory, and renames the template's `gitignore` back to `.gitignore`
(npm strips dotfiles named `.gitignore` from published tarballs, so the template
stores it un-dotted). It refuses a non-empty target directory and validates that
the derived name is a legal npm package name. No network, no dependencies beyond
zod.
