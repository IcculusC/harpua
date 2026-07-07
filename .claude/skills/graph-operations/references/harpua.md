# Harpua overlay

Repo-specific deltas on top of the framework-generic `@harpua/langgraph` recipes at `packages/langgraph/skills/graph-operations/references/{tool,node,graph}.md`. Read the matching generic recipe first, then apply this.

## Generating files (apps/api)

Every recipe starts by generating the file with a Nest schematic. Run it from the repo root through the workspace filter. Chat-demo files live flat in `src/chat/`, so pass `--flat` — without it the schematic nests each artifact in its own subfolder (`src/chat/<name>/<name>.ts`):

```bash
# node or tool provider → a provider
pnpm --filter @harpua/api exec nest g provider chat/<name> --flat
# graph definition → a class
pnpm --filter @harpua/api exec nest g class chat/<name>.graph --flat
```

`nest-cli.json` sets `sourceRoot: src`, so the `chat/<name>` argument resolves under `src/chat/`. Observed output for `nest g provider chat/sentiment --flat`:

```
CREATE src/chat/sentiment.ts          # @Injectable() export class Sentiment {}
CREATE src/chat/sentiment.spec.ts
UPDATE src/chat/chat.module.ts        # adds the import + a providers[] entry
```

and for `nest g class chat/summary.graph --flat`:

```
CREATE src/chat/summary.graph.ts      # export class SummaryGraph {}
CREATE src/chat/summary.graph.spec.ts # class generates no module wiring
```

The class name is the PascalCase of the last path segment with **no** `.provider` suffix (`sentiment` → `Sentiment`); rename the class/file to your convention after generating. Keep the generated spec — don't pass `--no-spec`.

## Verification

Always finish with the root protocol, not a per-package command:

```bash
pnpm turbo build lint test --force
```

If `apps/api` runtime behavior changed, also boot it and curl the affected flow, and run the piped CLI check. Full protocol and exact commands: the `verify` skill.

## The chat demo's model is a mock

`apps/api/src/chat/mock-chat-model.ts` is a deterministic `MockChatModel`, not a real LLM — it will never call a new tool or reach a new node until you teach it to. Adding something user-facing in the chat demo:

1. Add routing in `respond()` so some input emits the right `tool_calls`/message (mirror the existing `lookup_order` branch and its `/order\s+#?([A-Za-z0-9-]+)/i` regex).
2. **Update the canned capability/help reply** (the final `return new AIMessage('Hi! I can check an order…')`) to mention the new capability. Baseline agents forget this and the help text goes stale.

## Exemplars in this repo

- **Tool**: `apps/api/src/chat/order.tools.ts` (provider); `packages/langgraph/src/__tests__/agentic.spec.ts` (tool exercised end-to-end through the graph, asserts DI side effects via `orderService.calls`); `apps/api/src/chat/chat.e2e.spec.ts` (HTTP-level, asserts `orders.lookups`).
- **Node/edge**: `apps/api/src/chat/chat.graph.ts` (`CallModelNode`, `ApprovalNode`); `packages/langgraph/src/__tests__/fixtures.ts` (`NodeA`, `LogStamp`); `linear.spec.ts` (state flow + DI) and `interrupt.spec.ts` (pause/resume).
- **Graph/module/checkpointer**: `apps/api/src/chat/chat.graph.ts`, `chat.module.ts`, `chat.service.ts`; library-side `__tests__/agentic.spec.ts`, `linear.spec.ts`, `subgraph.spec.ts`. New optional checkpointer driver: follow the pattern in `packages/langgraph/src/checkpointer.ts` (see `references/package.md`).

## Common Mistakes (repo-specific)

- Shipping a demo tool or node without updating `MockChatModel` routing AND its help text.
- Verifying with `pnpm --filter @harpua/api test` (or any per-package command) instead of the root protocol `pnpm turbo build lint test --force`.
