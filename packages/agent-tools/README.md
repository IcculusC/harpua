# @harpua/agent-tools

Framework-agnostic prebuilt [LangChain](https://github.com/langchain-ai/langchainjs)
tools for agents. Each tool is a plain `tool()` instance, so it drops into any
LangChain / LangGraph TypeScript app — a `ToolNode`, `createReactAgent`,
`bindTools`, or your own executor. The package depends only on
`@langchain/core` and `zod` (both peers): no NestJS, no LangGraph runtime.

## Install

```bash
pnpm add @harpua/agent-tools
# peers you almost certainly already have:
pnpm add @langchain/core zod
```

## Tools

### `thinkTool(options?)`

The Anthropic-style [think tool](https://www.anthropic.com/engineering/claude-think-tool):
a no-op scratchpad the model calls to record reasoning between tool calls. The
handler returns an empty string — nothing executes; the thought is simply logged
for the model's own benefit. Useful before an irreversible action, when policies
conflict, or when a tool result is surprising.

```ts
import { thinkTool } from "@harpua/agent-tools";
import { ToolNode } from "@langchain/langgraph/prebuilt";

// Vanilla LangGraph: mount it in a ToolNode like any other tool.
const toolNode = new ToolNode([thinkTool()]);
```

Tune the when-to-think guidance per domain by overriding the description:

```ts
const think = thinkTool({
  description:
    "Think before cancelling or refunding: confirm the order state and that " +
    "the customer's request matches policy.",
});
```

`options` is validated with zod (`{ description?: string }`, unknown keys
rejected). The tool's input schema is `z.object({ thought: z.string() })`.

### `codeExplorationTools(options)`

A family of **read-only, sandboxed, context-safe** tools for navigating a
codebase — `search_code`, `read_lines`, and `file_stats`. Every path is confined
to `options.root` (`..` traversal and symlink escapes are refused), every result
is bounded (match / byte / page / entry caps with explicit truncation markers so
no single call floods the model's context), and nothing ever writes. The tool
descriptions teach the workflow: size things up with `file_stats`, locate lines
with `search_code`, then page just those with `read_lines`.

```ts
import { codeExplorationTools } from "@harpua/agent-tools";
import { ToolNode } from "@langchain/langgraph/prebuilt";

// One bundle, shared sandbox + caps. Defaults shown are optional.
const tools = codeExplorationTools({
  root: process.cwd(),
  pageLines: 200, // read_lines page size
  maxMatches: 50, // search_code match cap
  maxOutputBytes: 16_384, // byte cap on streamed output
  maxFileBytes: 2_000_000, // read_lines size ceiling
});

const toolNode = new ToolNode(tools);
```

- **`search_code`** `{ pattern, glob? }` — regex search via [ripgrep](https://github.com/BurntSushi/ripgrep)
  (`rg` must be installed; the tool returns an install hint if it isn't). Respects
  ignore files, distinguishes "No matches." from a real error, and caps output.
- **`read_lines`** `{ path, start? }` — one line-numbered page of a text file with
  a `file — lines A–B of TOTAL` header and the next `start=` when more remain.
  Refuses binary and oversize files.
- **`file_stats`** `{ path? }` — line count / byte size / binary flag for a file,
  or a bounded per-file listing for a directory (omit `path` for the root).

`options` is validated with zod (`root` required; every cap is a positive
integer with a default; unknown keys rejected). The individual factories
(`searchCodeTool`, `readLinesTool`, `fileStatsTool`) are exported too — the
bundle is the primary API since the three share one sandbox configuration.

## Using with `@harpua/langgraph`

[`@harpua/langgraph`](../langgraph) accepts these tools directly in a graph's
`tools` array, mixed freely with its own `@LangGraphTool` provider classes:

```ts
import { LangGraph, defineEdges, START, TOOLS, END } from "@harpua/langgraph";
import { thinkTool } from "@harpua/agent-tools";

@LangGraph({ name: "agent", state: AgentState, tools: [OrderTools, thinkTool()] })
export class AgentGraph {
  edges = defineEdges<AgentState>([
    { from: START, to: CallModel },
    { from: CallModel, to: route<AgentState>(shouldContinue, [TOOLS, END]) },
    { from: TOOLS, to: CallModel },
  ]);
}
```

The raw tool is mounted into the same `ToolNode` and traced with a
`langgraph.tool think` span like any DI-bound tool. The code-exploration bundle
composes the same way — spread `...codeExplorationTools({ root })` into a graph's
`tools` array and each tool is mounted and traced like any other raw tool.
