# Web-Research Tool Family for `@harpua/agent-tools` — Design

**Date:** 2026-07-08
**Status:** Approved (brainstorming session)
**Target package:** `packages/agent-tools`

## Purpose

Give agents a way to research the web and build a searchable local corpus:
a `web_search` tool backed by a SearXNG instance, and a `fetch_url` tool
that fetches a page, converts it to markdown, and saves it to a directory.
Saved pages are then explorable with the package's existing
`fileExplorationTools` family (`search_files` / `read_lines` / `file_stats`)
jailed to that directory. The originating use case is a circuit-design
notebook agent saving vendor part pages and app notes per project, but the
tools are generic and framework-agnostic like everything in this package.

## Decisions made

- **Lives in core, not the app.** Implemented here in `@harpua/agent-tools`;
  consuming apps import from npm after release. No app-side work is part of
  this effort.
- **Zero new runtime dependencies.** The package's established philosophy
  (peers only: `@langchain/core`, `zod`; file search shells out to ripgrep).
  HTML→markdown conversion is a built-in extractor, not a library.
- **SearXNG is env-agnostic from the package's view:** the factory takes an
  explicit `baseUrl` option; apps decide how they wire env/config into it.
- **HTML only in v1.** `application/pdf` responses get a friendly refusal
  string (detected via content-type). PDF text extraction is explicitly out
  of scope — it needs a real dependency and its own design.
- **Factory + bundle shape** mirroring `file-exploration/`: individual
  `webSearchTool(options)` / `fetchUrlTool(options)` factories plus a
  `webResearchTools(options)` bundle, strict zod option schemas, bounded
  context-safe defaults, one artifact per file.

## Components

All new code in `packages/agent-tools/src/web-research/`.

### `options.ts`

Strict zod option schemas plus `resolveOptions`-style parsers, mirroring
`file-exploration/options.ts`.

`webSearchToolOptionsSchema`:

| Option | Type | Default | Meaning |
|---|---|---|---|
| `baseUrl` | `string` (min 1) | required | SearXNG instance base URL, e.g. `http://localhost:8080`. |
| `maxResults` | positive int | 5 | Results included in the tool reply (hard-capped at 10). |
| `timeoutMs` | positive int | 10_000 | Abort the search request after this long. |
| `fetchFn` | function | `globalThis.fetch` | Injectable fetch for deterministic tests. |

`fetchUrlToolOptionsSchema`:

| Option | Type | Default | Meaning |
|---|---|---|---|
| `saveDir` | `string` \| `(config?) => string` | required | Directory saved pages land in. A function receives the LangChain `RunnableConfig` at call time so apps can resolve per-thread/per-project dirs. |
| `maxResponseBytes` | positive int | 2_000_000 | Response-size ceiling; the body read is aborted past it and the tool returns a friendly refusal. |
| `timeoutMs` | positive int | 15_000 | Abort the fetch after this long. |
| `fetchFn` | function | `globalThis.fetch` | Injectable fetch for tests. |
| `now` | `() => Date` | `() => new Date()` | Injectable clock for the frontmatter `fetched` date (repo rule: no bare `new Date()` in logic under test). |

`webResearchToolsOptionsSchema`: the union of both (single `fetchFn`/
`timeoutMs` applying to both tools; `baseUrl` and `saveDir` required).

Unknown keys rejected (`.strict()`) on all three.

### `web-search.ts` — `webSearchTool(options)`

- Tool name `web_search`; input schema `{ query: string }` with a
  `.describe()` telling the model what makes a good query.
- Calls `GET {baseUrl}/search?q={query}&format=json` with an
  `AbortSignal.timeout(timeoutMs)`.
- Parses the response body with a zod schema reading only what we use:
  `{ results?: Array<{ title: string; url: string; content?: string }> }`.
- Reply format: a numbered markdown list, one entry per result up to
  `maxResults`: title, URL, and the snippet (`content`) when present.
- Friendly-string failure modes (the tool never throws): network error /
  timeout; non-2xx status (message includes the status and a reminder that
  SearXNG's JSON format must be enabled in `settings.yml`); unparseable
  body; zero results ("no results for …, try different terms").

### `fetch-url.ts` — `fetchUrlTool(options)`

- Tool name `fetch_url`; input schema `{ url: string }`.
- Pipeline:
  1. Validate scheme is `http:`/`https:` (zod refine) — anything else is a
     friendly refusal.
  2. Fetch with `AbortSignal.timeout(timeoutMs)`.
  3. Gate on content-type: `text/html` → convert; `text/plain` → save
     as-is; `application/pdf` → refusal ("PDFs aren't supported yet — v1
     saves HTML pages only"); anything else → refusal naming the type.
  4. Enforce `maxResponseBytes` while reading the body.
  5. Convert HTML to markdown via the built-in extractor.
  6. Derive the filename: slug from the page `<title>` (fallback: URL host
     + path), suffixed with a short content-independent hash of the full
     URL so distinct URLs never collide, `.md` extension. Re-fetching the
     same URL produces the same filename and overwrites it — a refresh,
     not a duplicate.
  7. `mkdir -p` the resolved `saveDir`, write the file with YAML
     frontmatter: `url`, `title`, `fetched` (`YYYY-MM-DD` from the injected
     clock).
  8. Reply: saved path, title, line count, and a pointer that the file is
     now searchable with `search_files` / readable with `read_lines`.
- Friendly-string failure modes: bad scheme, network error/timeout, non-2xx,
  refused content types, oversize body, filesystem write failure.
- `saveDir` as a function is called per invocation with the tool's
  `RunnableConfig`, enabling thread-scoped directories (e.g.
  `sources/<thread_id>/`) without the package knowing about threads.

### `html-to-markdown.ts` — pure function, no I/O

`htmlToMarkdown(html: string): { title?: string; markdown: string }`

- Drops `<script>`, `<style>`, `<noscript>`, `<head>` (after capturing
  `<title>`), and HTML comments.
- Decodes the common named entities plus numeric entities.
- Converts: `h1–h6` → `#`-headings; `p`/`div`/`br` boundaries → paragraph
  breaks; `li` → `- ` bullets (nested lists flattened one level);
  `a href` → `[text](href)`; `pre`/`code` → fenced/inline code; `tr`/`td`
  → best-effort pipe-table rows; everything else → its text content.
- Collapses runs of blank lines to one; trims trailing whitespace.
- Explicit non-goal: rendering fidelity. The output is optimized to be
  ripgrep-able text, and the function is upgradeable later without changing
  the tool contract.

### `web-research-tools.ts` — `webResearchTools(options)`

Bundle returning `[webSearchTool(...), fetchUrlTool(...)]` from one shared
options object, mirroring `fileExplorationTools`. Individual factories stay
exported for one-off use.

### `index.ts` additions

Export the bundle, both factories, and the option types, following the
existing comment style grouping tool families.

## Error handling

Every failure path returns a string through the tool result — network,
HTTP status, parse, content-type, size cap, filesystem. Nothing throws past
the tool boundary. Messages are specific enough for the model to relay or
adapt ("SearXNG returned 403 — is the JSON format enabled?").

## Security posture (documented, not over-built)

The model chooses the URLs. v1 enforces scheme http/https only — no
private-IP blocking, because localhost SearXNG and intranet pages are a
feature for local-first agents. JSDoc on both factories warns that
publicly-deployed apps should wrap `fetch_url` (e.g. with
`requireApproval()` from `@harpua/langgraph`) or front it with an
allowlist. `saveDir` filenames are slug-sanitized so a hostile page title
cannot escape the directory.

## Testing

Fully offline and deterministic (repo rule), in
`packages/agent-tools/src/__tests__/` alongside the existing suites:

- **`html-to-markdown`:** fixture HTML strings → exact expected markdown;
  covers headings/lists/links/code/tables, entity decoding, script/style
  stripping, whitespace collapsing, title capture, and pathological input
  (unclosed tags, empty body).
- **`web_search`:** injected `fetchFn` returning canned SearXNG JSON —
  result formatting, `maxResults` capping, and every failure mode (non-2xx,
  invalid JSON, empty results, timeout via rejecting fetch).
- **`fetch_url`:** injected `fetchFn` + temp dir — happy path writes
  frontmatter + markdown and reports the path; content-type refusals (PDF,
  image); oversize refusal; scheme refusal; `saveDir`-as-function receives
  the config; filename collision behavior (two URLs, same title → distinct
  files); injected clock stamps `fetched`.
- **Integration (closes the loop):** `fetch_url` a fixture page into a temp
  dir, then `fileExplorationTools({ root })`'s `search_files` finds a string
  from the page body inside the saved markdown.

## Out of scope

- PDF text extraction (own design + dependency later).
- Any change to consuming apps (the notebook agent bumps the dep and mounts
  the tools after the npm release).
- Result caching/dedup across fetches, robots.txt handling, JS rendering.
- Private-IP/SSRF blocking (documented instead, see Security posture).

## Process

Feature branch `feat/web-research-tools`; a changeset with a **minor** bump
for `@harpua/agent-tools` (new feature); package README section for the new
family; verification per the repo's ROOT protocol
(`pnpm turbo build lint test --force`); lands via PR merged by the
maintainer.
