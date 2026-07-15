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
  - [Runtime skills — `use_skill` + `read_skill_file`](#runtime-skills--use_skill--read_skill_file)
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

**Secrets stay unreadable.** `search_files` never searches hidden files (dotfiles
and dot-directories), and no glob overrides that — so a search can't be used to
read `.env`. `read_lines` and `file_stats` refuse a curated set of secret paths
(`.env`, `.ssh/`, private keys, and similar; configurable via
`blockedSecretPatterns`), checked on the resolved real path so a symlink or `..`
can't smuggle one through. Non-secret dotfiles (`.github/`, `.vscode/`) and
`.env.example`-style templates stay readable.

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
  ignore files, skips hidden files, and caps output. On an empty result it says
  *why* — genuinely absent, glob matched nothing, or the matches were hidden or
  ignored — rather than a bare "No matches." that an agent could misread as
  "not there" about files it never opened.
- **`read_lines`** `{ path, start? }` — one line-numbered page of a text file with
  a `file — lines A–B of TOTAL` header and the next `start=` when more remain.
  Refuses binary files, oversize files, and secret paths.
- **`file_stats`** `{ path? }` — line count / byte size / binary flag for a file,
  or a bounded per-file listing for a directory (omit `path` for the root).
  Refuses to stat a secret path.

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

#### Two backends, two names: `search_knowledge` + `search_memory`

The tool's `name` and `description` are overridable, so an app can mount the
fetched-sources corpus and a remembered-excerpts store as **two distinctly
named tools** and let the agent pick a backend explicitly. With a bring-your-own
`store` the corpus `root` is not required, and the tool's failure/empty
messages carry whichever name you gave it. Pair the store with `remember`
(the write half) and point its `searchToolName` at the renamed reader so its
guidance stays coherent:

```ts
import {
  searchKnowledgeTool,
  rememberTool,
  InMemoryVectorStore,
} from "@harpua/agent-tools";

const store = new InMemoryVectorStore({ topK: 5 });

const toolNode = new ToolNode([
  // fetched pages / PDFs / notes on disk:
  searchKnowledgeTool({ root: sources, embeddings }),
  // excerpts the agent deliberately saved:
  searchKnowledgeTool({
    store,
    embeddings,
    name: "search_memory",
    description:
      "Search excerpts you previously chose to remember. Prefer this for " +
      "facts you saved yourself; use search_knowledge for the full sources.",
  }),
  rememberTool({ store, embeddings, searchToolName: "search_memory" }),
]);
```

#### Bulk ingest — chunking controls on `ingest()`

`ingest(documents, options)` is the source-agnostic write path behind
`syncCorpus` and `remember`: chunk → sanitize → junk-filter → embed
(batched) → upsert (batched). Beyond `embeddings`, `store`, and
`maxChunkChars` it takes four knobs, all optional:

- **`sanitize?: (text: string) => string`** — applied to each chunk's text
  before everything else (the junk floor, the embedder, and the stored text
  all see its output). Default: strip C0/C1 control characters, keeping `\t`
  and `\n`. Scraped PDFs routinely carry `0x01`–`0x05`/`0x0E`; those bytes
  are pure embedding noise and have broken the postgres wire protocol on
  insert. Pass your own function to add trimming/normalization, or
  `(t) => t` to opt out.
- **`minAlnumChars?: number`** (default `0` = off) — drop chunks whose
  **alphanumeric** character count (letters + digits, not raw length) is
  below the floor. Calibration: a sparse-but-real table row like
  `| 200-400mA | 5V |` carries 10 alnum chars and survives a floor of 8,
  while `---` separators and heading-only stubs carry 0–6 and only poison
  the vector space. Field data: a floor of 8 took junk chunks in a scraped
  hardware corpus from 11% to 0.
- **`embedHeadingTrail?: boolean`** (default `false`) — when true, the text
  sent to the embedder becomes `"<headingTrail joined with ' > '>: <chunk
  text>"` (e.g. `"Power > Limits: The regulator caps at 5V."`); chunks with
  no trail embed as raw text. The **stored** text stays the raw chunk text
  either way. The default keeps the legacy embedding input (heading trail +
  body joined by newlines), so existing indexes stay valid.
- **`batchSize?: number`** (default `64`) — max records per
  `embeddings.embedDocuments` call **and** per `store.upsert` call. A 1.9MB
  document at small chunk sizes is ~6k chunks; one giant embed call plus one
  giant insert has crashed node natively in the field.

Options are zod-validated at call time — a negative floor, fractional batch
size, non-function sanitizer, or unknown key throws before any embedding
work.

Every stored record also carries **`metadata.chunkIndex`**: sequential per
document and **dense after the junk filter** (0, 1, 2, … with no gaps).
That's the handle for window expansion at retrieval time:

> **Two operational notes.** Upserts are batched: a store failure mid-ingest
> can leave earlier batches committed (embedding failures still happen before
> any store write). And id-less documents are keyed by a content hash of the
> raw text — re-ingesting the same text with different chunking options
> (floor, cap) writes under new positions instead of replacing, stranding the
> old records; give documents explicit `id`s when options may evolve.

### Window-expansion retrieval (recipe)

Chunks sized for embedding precision are often too small to answer from.
The fix is consumer-side: store `chunkIndex` in a real `chunk_index` column
in your `VectorStore` adapter, then widen each hit into its neighborhood at
query time —

1. Vector-search as usual; collect the top-K hits.
2. For each hit, fetch its neighbors with **one indexed range query** per
   window: `WHERE document_key = $1 AND chunk_index BETWEEN $2 - w AND $2 + w`
   (index `(document_key, chunk_index)`).
3. Within a document, **stitch consecutive runs** of chunk indexes back into
   passages (indexes are dense, so `n, n+1, n+2` means adjacent text).
4. **Merge overlapping windows** from multiple hits in the same document into
   one passage; the passage's **score is its best hit's score**.

Two warnings from the field, both load-bearing:

- **Coerce `chunk_index` to a number at the query boundary.** Several pg
  drivers return integer columns as **strings**, and `"5941" + 2` in JS
  CONCATENATES to `"59412"` — a window of `[5941, 59412]` swallows an entire
  document (a live result once weighed 1.2MB). `Number(row.chunk_index)`
  before any arithmetic.
- **Hard-cap every stitched passage** (~8KB is a sane ceiling) so no future
  bug — a bad window bound, a runaway merge — can blow a model context
  through the retrieval path.

### Runtime skills — `use_skill` + `read_skill_file`

Skills for the **app's own agent at runtime** — the counterpart to linking
skills into `.claude/skills` for a developer's coding agent. The agent sees a
menu of procedures, loads one when it applies, and reads its reference files
on demand at a stated cost.

```ts
import { SkillRegistry, useSkillTool, readSkillFileTool } from "@harpua/agent-tools";

const registry = new SkillRegistry(".agents/skills"); // <skill>/SKILL.md per skill
const tools = [useSkillTool({ registry }), readSkillFileTool({ registry })];
```

- **`SkillRegistry(dir, { onWarn? })`** scans `<skill>/SKILL.md` files
  (frontmatter `name` + `description`; `name` must match the directory). A
  directory with no `SKILL.md` at all gets one `onWarn` line (a misnamed
  `skill.md` is a real failure mode) but is never counted as skipped — it
  was never a skill candidate. Malformed, symlinked, or oversized entries
  ARE skipped, with a warning — never a crash. `rescan()` picks up skills
  installed mid-session and reports `{ count, names, skipped, skippedSkills,
  changed }`: `skippedSkills` is `{ name, reason }[]`, one entry per skip,
  `reason` being the same detail sent to `onWarn` minus the `skills: `
  prefix (distinct frontmatter failures — a bad name vs. an empty
  description — get distinct reasons). Skips are data a caller can act on,
  not just a log line — a consumer once burned an hour chasing a silently
  skipped skill before realizing it had tripped the 16KB body cap. `changed`
  compares rendered menu bytes (a `true` means the next call's system prompt
  moves and the provider's prefix cache resets).
- **`use_skill(name)`** returns the skill body **as a tool result** — a skill
  is a procedure that must persist through the tool loop, and an ephemeral
  prompt injection hands the model a checklist that vanishes before cycle 2.
  References are LISTED with line counts, never read. Unknown name → the menu.
- **`read_skill_file(skill, path, startLine?, endLine?)`** reads out of a
  **per-skill jail** (the skill's own directory is the sandbox root, so
  `../other-skill/…` cannot resolve, symlinks included) with hard caps per
  read — progressive disclosure enforced structurally, not by asking nicely.
- **`renderSkillMenu(registry.menu(), opts?)`** renders the system-prompt TOC
  (`""` when empty, regardless of `opts`). `opts.header` overrides the
  leading line for a caller that wants different wording; omit it (or pass
  `{}`) for the exact byte-identical default. Putting the LIVE menu in the
  system prompt is a ~12-line `wrapModelCall` middleware in your framework —
  with `@harpua/langgraph`, follow the "Composing the system prompt" recipe
  in its `agents-and-middleware` skill reference (append to the leading
  SystemMessage; byte-stable output keeps the prompt cache warm).

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
