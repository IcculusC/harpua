# create-harpua-app

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
