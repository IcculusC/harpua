# create-harpua-app

## 0.1.3

### Patch Changes

- 61399da: Template `start` and `chat` scripts now load `.env` automatically via node's
  `--env-file-if-exists` (the README already told users to copy `.env.example`,
  but no script actually read it). `start:dev` can't take node flags through
  `nest start --watch`, so the README documents exporting variables instead.
  Also keeps stray local `template/dist` build artifacts out of the published
  tarball.

## 0.1.2

### Patch Changes

- 6e42596: Template catches up to `@harpua/langgraph@0.1.3`'s approval-gated tools. Adds an
  approval-gated `send_weather_report` tool (records into a new `OutboxService`),
  teaches the mock model to route the send/email intent and updates its help text,
  adds the `tool_approval_request` render + y/n resume flow to the CLI and a
  zod-validated `POST /agent/:threadId/resume` endpoint (400 on a bad body), bumps
  the `@harpua/langgraph` floor to `^0.1.3`, and documents the approval flow in the
  README. Includes a gated-tool test (approve records the outbox; decline leaves it
  empty).

## 0.1.1

### Patch Changes

- 1aaa2df: The scaffolded template now gets its chat model from `@harpua/models` (`ChatModelModule.forRoot(...)` + `@InjectChatModel()`) instead of a hand-rolled `chat-model.provider.ts` factory. It keeps the scripted weather `MockChatModel` as the mock arm's factory (mock-by-default is unchanged) and adds OpenRouter as the recommended real arm. README and `.env.example` document the new `MODEL_PROVIDER` options.
- 07e9733: The scaffolded weather agent now binds its tools to the chat model via
  `provideGraphBoundModel` (new `AGENT_BOUND_MODEL` token), so a real model can
  actually emit the `get_weather` / `think` tool calls instead of only the
  scripted `MockChatModel`. `CallModelNode` injects the bound model. Mock-by-
  default is unchanged — `MockChatModel.bindTools` is a no-op that returns itself.

## 0.1.0

### Minor Changes

- a6a2ced: Add `create-harpua-app`, a scaffolder for a runnable NestJS + LangGraph weather
  agent. `pnpm create harpua-app my-agent` copies an embedded template — a
  `get_weather` tool over the keyless Open-Meteo API (with `fetch` injected via
  DI), the prebuilt `thinkTool()` mounted alongside it, a ReAct-style graph with a
  memory checkpointer, and a `MODEL_PROVIDER` factory (mock | ollama |
  openai-compatible) defaulting to a deterministic in-project mock so the app runs
  offline out of the box. Ships an HTTP endpoint, a CLI REPL, deterministic tests,
  self-contained tooling, and `prepare: harpua-skills` to auto-link agent skills.
