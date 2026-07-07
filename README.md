# harpua

A reusable toolkit for building [LangGraph](https://langchain-ai.github.io/langgraphjs/) agents with [NestJS](https://nestjs.com/): graphs assembled from plain Nest providers, typed edge lists, pluggable checkpointers, streaming, human-in-the-loop interrupts, and OpenTelemetry tracing — plus companion packages for testing and prebuilt agent tools.

## Packages

- [`@harpua/langgraph`](packages/langgraph) — the core framework. Nodes are ordinary `@Injectable` providers reusable across graphs; graphs are typed class-ref edge lists compiled and validated at bootstrap; tools bind through DI (or mount as raw LangChain tool instances); checkpointing supports memory, Postgres, SQLite, MongoDB, and Redis via optional peers; the injected facade covers invoke, all stream modes, interrupt/resume, and checkpoint time travel. Emits OpenTelemetry spans when an SDK is registered (Langfuse-compatible via `@langfuse/otel`). Ships its agent skills in the tarball.
- [`@harpua/langgraph-testing`](packages/langgraph-testing) — deterministic testing helpers: scripted/rule-based fake chat models, stream collectors, interrupt assertions, a Nest testing-module harness, and an injectable fixed clock.
- [`@harpua/agent-tools`](packages/agent-tools) — framework-agnostic prebuilt LangChain tools (currently the Anthropic-style `think` scratchpad tool). Depends only on `@langchain/core` and `zod`; works with any LangGraph app and drops straight into `@harpua/langgraph` graphs.
- `packages/typescript-config`, `packages/eslint-config` — shared build config (private).

## Proof harness

- [`apps/api`](apps/api) — a NestJS 11 app exercising the toolkit end-to-end: an agentic chat graph with a deterministic mock LLM (no API keys), tool calls through DI, approval interrupts with resume, thread persistence, an SSE streaming endpoint, and a CLI REPL (`pnpm --filter @harpua/api chat`). It is a test bed, not the product.

## Agent skills

`@harpua/langgraph` ships [agentskills.io](https://agentskills.io)-format recipes under `skills/graph-operations/` covering tools, nodes, graphs, testing, debugging (including Postgres/Redis checkpoint time travel), human-in-the-loop, streaming, checkpointers, and observability. The format is an open standard — the same skills work in Claude Code, OpenAI Codex, and other compatible agents. See the package README for wiring. This repo itself exposes its skills to both: `.claude/skills/` is the source of truth and `.agents/skills/` symlinks into it (with `AGENTS.md` → `CLAUDE.md` for Codex contributors).

## Requirements

- Node.js >= 20 (developed against v23.10.0)
- pnpm 9.15.0 (`packageManager` pinned in `package.json`)

## Usage

```bash
pnpm install
pnpm build
pnpm dev
pnpm lint
pnpm test
```

Tasks run through Turborepo; scope with `--filter` (e.g. `pnpm turbo test --filter @harpua/langgraph`).

## Releases

Publishing is automated with [changesets](https://github.com/changesets/changesets):

- Every change to a publishable package ships with a changeset — run `pnpm exec changeset`, pick the packages and bump, and commit the generated file alongside your change. (0.x: breaking = minor, feature/fix = patch.)
- A **Version Packages** PR is the publish button. The release workflow keeps it up to date; merging it bumps versions, writes changelogs, and publishes to npm. No other action publishes.
- Auth is npm [trusted publishing](https://docs.npmjs.com/trusted-publishers/) via GitHub OIDC — there are no npm tokens in the repo or CI.

## License

MIT for the publishable packages (`@harpua/langgraph`, `@harpua/langgraph-testing`, `@harpua/agent-tools`). See [LICENSE](LICENSE).
