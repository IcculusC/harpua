# @harpua/langgraph

## 0.1.5

### Patch Changes

- 0b9c12d: graph-operations skill (`tool.md`): add guidance on guarding a tool whose input is a model-supplied resource — a URL, filesystem path, or shell argument. Enforce the safe default in the handler rather than only documenting the risk; for URL fetches specifically, default-deny loopback/private/link-local/cloud-metadata hosts, restrict the scheme, and re-check the host after redirects.

## 0.1.4

### Patch Changes

- a1713aa: Add optional `approvalMessage` and `declineMessage` builders to approval-gated tools (`@LangGraphTool` and `requireApproval`). `approvalMessage(args)` surfaces custom wording in the interrupt payload (`ToolApprovalRequest` gains `message?: string`); `declineMessage(args, reason?)` overrides the default decline text. Both are only legal with `requiresApproval: true` (enforced at compile and registration), and are throw-safe — a throwing builder falls back and logs a warning rather than corrupting the run. Purely additive; tools without custom wording are unchanged.

## 0.1.3

### Patch Changes

- 0701c77: Add approval-gated tools: `@LangGraphTool({ requiresApproval: true })` and the raw-tool sibling `requireApproval(tool)` pause a tool with a `tool_approval_request` interrupt before it executes, running the real tool only on a resume with `{ approved: true }` (a decline returns a graceful ToolMessage the model can respond to). Enforcement lives in `buildGraphTools`, so it covers both the ToolNode executor and the model-bound schemas while keeping the model-facing tool identical to an unflagged one. The resume value is zod-validated. Exports `requireApproval` and the `ToolApprovalRequest` type. This replaces the mock-only `additional_kwargs` side-channel pattern, which a real LLM can never set.

## 0.1.2

### Patch Changes

- 07e9733: Add tool binding so a real chat model can emit the tool calls a graph's `TOOLS`
  node executes. New `provideGraphBoundModel({ provide, graph, model })` Nest
  custom-provider factory binds a graph's tools (`model.bindTools(...)`) to any
  DI token resolving to a `BaseChatModel` — the package stays model-library
  agnostic. Lower-level primitives `provideGraphTools({ graph })` +
  `getGraphToolsToken(graph)` expose the raw `StructuredToolInterface[]` for
  manual binding, and `buildGraphTools(graphDef, moduleRef)` is the single source
  of truth the `ToolNode` builder and the binding providers both use (so the
  model's advertised tools and the executor never drift). New `GraphBoundModel`
  type for annotating the injected token. A graph with no tools returns the model
  unchanged.
- 2a42d42: graph-operations recipes now lead with Nest schematic generate steps (node/tool provider → `nest g provider`, graph definition → `nest g class`) and forbid inlining new nodes/providers/graph-defs into existing files.
- cd21094: Ship a `graph-operations` skill reference for wiring chat models with `@harpua/models` (`references/models.md`), routed from the skill's SKILL.md.

## 0.1.1

### Patch Changes

- 4e6d572: Add the `harpua-skills` CLI. Run it (or set `"prepare": "harpua-skills"`) in a consuming project to link the agent skills shipped by installed `@harpua/*` packages into `.claude/skills` and `.agents/skills`, so Claude Code and Codex discover them automatically. Relative symlinks on POSIX, directory junctions on Windows; idempotent; never clobbers user-owned directories.
