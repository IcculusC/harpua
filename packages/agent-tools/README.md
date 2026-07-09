# @harpua/agent-tools

Framework-agnostic prebuilt [LangChain](https://github.com/langchain-ai/langchainjs)
tools for agents. Each tool is a plain `tool()` instance, so it drops into any
LangChain / LangGraph TypeScript app — a `ToolNode`, `createReactAgent`,
`bindTools`, or your own executor. Peer dependencies are `@langchain/core` and `zod`; runtime dependencies are `ml-distance` (pure JS, cosine similarity for the knowledge family) and `node-html-markdown` (HTML → markdown conversion for `fetch_url`); still no NestJS, no LangGraph runtime.

## Table of Contents

- [Install](#install)
- [Tools](#tools)
  - [`thinkTool(options?)`](#thinktooloptions)
  - [`fileExplorationTools(options)`](#fileexplorationtoolsoptions)
  - [Web research — `web_search` + `fetch_url`](#web-research--web_search--fetch_url)
  - [`fetchPdfTool(options)` — opt-in PDF fetching](#fetchpdftooloptions--opt-in-pdf-fetching)
  - [Knowledge — `search_knowledge`](#knowledge--search_knowledge)
- [Using with `@harpua/langgraph`](#using-with-harpualanggraph)

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

### `fileExplorationTools(options)`

A family of **read-only, sandboxed, context-safe** tools for navigating a
codebase — `search_files`, `read_lines`, and `file_stats`. Every path is confined
to `options.root` (`..` traversal and symlink escapes are refused), every result
is bounded (match / byte / page / entry caps with explicit truncation markers so
no single call floods the model's context), and nothing ever writes. The tool
descriptions teach the workflow: size things up with `file_stats`, locate lines
with `search_files`, then page just those with `read_lines`.

```ts
import { fileExplorationTools } from "@harpua/agent-tools";
import { ToolNode } from "@langchain/langgraph/prebuilt";

// One bundle, shared sandbox + caps. Defaults shown are optional.
const tools = fileExplorationTools({
  root: process.cwd(),
  pageLines: 200, // read_lines page size
  maxMatches: 50, // search_files match cap
  maxOutputBytes: 16_384, // byte cap on streamed output
  maxFileBytes: 2_000_000, // read_lines size ceiling
});

const toolNode = new ToolNode(tools);
```

- **`search_files`** `{ pattern, glob? }` — regex search via [ripgrep](https://github.com/BurntSushi/ripgrep)
  (`rg` must be installed; the tool returns an install hint if it isn't). Respects
  ignore files, distinguishes "No matches." from a real error, and caps output.
- **`read_lines`** `{ path, start? }` — one line-numbered page of a text file with
  a `file — lines A–B of TOTAL` header and the next `start=` when more remain.
  Refuses binary and oversize files.
- **`file_stats`** `{ path? }` — line count / byte size / binary flag for a file,
  or a bounded per-file listing for a directory (omit `path` for the root).

`options` is validated with zod (`root` required; every cap is a positive
integer with a default; unknown keys rejected). The individual factories
(`searchFilesTool`, `readLinesTool`, `fileStatsTool`) are exported too — the
bundle is the primary API since the three share one sandbox configuration.

### Web research — `web_search` + `fetch_url`

Search the web through a [SearXNG](https://docs.searxng.org) instance and
save pages locally as searchable markdown:

- **`web_search`** — queries `{baseUrl}/search?format=json` and returns a
  numbered list of results (title, URL, snippet). The instance must have the
  JSON format enabled in `settings.yml` (`search: formats: [html, json]`).
- **`fetch_url`** — fetches an http(s) page, converts HTML to markdown with
  [`node-html-markdown`](https://github.com/crosstype/node-html-markdown)
  (plain text is saved as-is; PDFs and other binary types are politely
  refused), and writes it to `saveDir` with
  `url` / `title` / `fetched` frontmatter. Re-fetching a URL refreshes its
  file. `saveDir` can be a function of the run config for per-thread dirs.

Pair the family with `fileExplorationTools` jailed to the same directory so
the agent can search what it saved:

```ts
import fs from "node:fs";
import { webResearchTools, fileExplorationTools } from "@harpua/agent-tools";
import { ToolNode } from "@langchain/langgraph/prebuilt";

const sources = "./sources";
fs.mkdirSync(sources, { recursive: true });
const toolNode = new ToolNode([
  ...webResearchTools({ baseUrl: "http://localhost:8080", saveDir: sources }),
  ...fileExplorationTools({ root: sources }),
]);
```

Both tools return every failure (network, HTTP status, content type, size
cap, filesystem) as a friendly string — they never throw mid-graph. The
model chooses the URLs, so `fetch_url` refuses loopback/private/link-local
addresses by default (including redirects that land on one) — pass
`allowPrivate: true` to reach a service on your own machine or LAN. That's a
safety net, not a boundary: it inspects the literal hostname only (no DNS
resolution), so real egress control belongs at the deployment layer, and
publicly-deployed apps should still gate `fetch_url`
(e.g. `requireApproval()` from `@harpua/langgraph`) or front it with an
allowlist.

### `fetchPdfTool(options)` — opt-in PDF fetching

`fetch_pdf` is the same fetch → save → explore loop as `fetch_url`, but for
PDFs: it fetches an http(s) URL, verifies the response is `application/pdf`,
extracts the text, and writes it to `saveDir` as markdown with the same
`url` / `title` / `fetched` frontmatter — so a fetched PDF becomes searchable
by `fileExplorationTools` exactly like a fetched page. It inherits every
guard from `fetch_url` (http(s)-only, private/loopback refusal including
redirects) and likewise never throws — bad schemes, non-PDF content types,
oversize bodies, extraction failures, and filesystem errors all come back as
friendly strings. Sizing is its own, though: `fetch_pdf` checks the declared
+ actual response size against its own **16 MB** cap, independent of
`fetch_url`'s 2 MB (HTML/text-oriented) cap — real-world PDFs regularly
exceed the latter. On success it reports the extracted text's size as
chars/pages (a PDF's extracted text is often one long run with no newlines,
so a line count wouldn't be meaningful).

It is **opt-in**: `fetch_pdf` is exported on its own and is **not** part of
the `webResearchTools()` bundle — add it explicitly. Text extraction uses
[`unpdf`](https://github.com/unjs/unpdf), an **optional peer dependency** you
install only if you want PDF support:

```bash
pnpm add unpdf
```

```ts
import fs from "node:fs";
import {
  webResearchTools,
  fetchPdfTool,
  fileExplorationTools,
} from "@harpua/agent-tools";
import { ToolNode } from "@langchain/langgraph/prebuilt";

const sources = "./sources";
fs.mkdirSync(sources, { recursive: true });
const toolNode = new ToolNode([
  ...webResearchTools({ baseUrl: "http://localhost:8080", saveDir: sources }),
  fetchPdfTool({ saveDir: sources }), // opt-in; needs `unpdf` installed
  ...fileExplorationTools({ root: sources }),
]);
```

`options` mirrors `fetchUrlTool`'s (`saveDir` required; `maxResponseBytes`,
`timeoutMs`, `allowPrivate`, `fetchFn`, `now` optional). If `unpdf` isn't
installed the tool returns an install hint instead of throwing, so the rest of
your graph keeps working without it.

### Knowledge — `search_knowledge`

Semantic-ish retrieval over a directory of markdown — the same `sources`
directory `fetch_url` and `fetch_pdf` fill. Chunks are heading-aware with
true line spans; vectors live in a hidden sidecar (`.knowledge/index.json`)
that refreshes lazily on every search (only new/changed files re-embed).
Results carry `file.md:start-end` references that feed `read_lines`.

Keyless by default: the built-in `MockEmbeddings` is a deterministic
lexical stand-in (word overlap, not meaning). For real semantic search,
pass any LangChain embeddings instance:

```ts
import { searchKnowledgeTool, webResearchTools, fileExplorationTools } from "@harpua/agent-tools";
import { OpenAIEmbeddings } from "@langchain/openai";
import { ToolNode } from "@langchain/langgraph/prebuilt";
import fs from "node:fs";

const sources = "./sources";
fs.mkdirSync(sources, { recursive: true });

const embeddings = new OpenAIEmbeddings({
  model: "nomic-ai/nomic-embed-text-v1",
  apiKey: process.env.OPENROUTER_API_KEY,
  configuration: { baseURL: "https://openrouter.ai/api/v1" },
});

const toolNode = new ToolNode([
  ...webResearchTools({ baseUrl: "http://localhost:8080", saveDir: sources }),
  ...fileExplorationTools({ root: sources }),
  searchKnowledgeTool({ root: sources, embeddings }),
]);
```

Switching embedders (or from the mock to a real one) is detected via a
fingerprint — constructor name, `model` when the embedder exposes one, vector
dimension, and chunk size — and triggers a clean re-index — vector spaces
never mix. If you swap between two embedders the fingerprint can't tell
apart (same class, no distinguishing `model`), just delete `.knowledge/`:
it's only a cache; markdown stays the source of truth. Runtime dependency
note: this family adds `ml-distance` (pure JS) for cosine similarity — see
the intro for the package's full runtime dependency list.

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
`langgraph.tool think` span like any DI-bound tool. The file-exploration bundle
composes the same way — spread `...fileExplorationTools({ root })` into a graph's
`tools` array and each tool is mounted and traced like any other raw tool.
