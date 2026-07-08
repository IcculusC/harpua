# Web-Research Tool Family Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `web-research` tool family to `@harpua/agent-tools` — `web_search` (SearXNG-backed), `fetch_url` (fetch → markdown → save to a directory), and a `webResearchTools()` bundle — so agents can research the web and build a corpus explorable with the existing `fileExplorationTools`.

**Architecture:** Mirrors the existing `file-exploration/` family exactly: one artifact per file under `packages/agent-tools/src/web-research/`, strict zod option schemas with bounded context-safe defaults, `factory(options) → tool()` shape, all failures returned as friendly strings. Zero new runtime dependencies — HTML→markdown is a built-in extractor; HTTP goes through an injectable `fetchFn` defaulting to `globalThis.fetch`.

**Tech Stack:** TypeScript (CommonJS build), zod, `@langchain/core` `tool()`, Jest + ts-jest per-package, pnpm + Turborepo.

Spec: `docs/superpowers/specs/2026-07-08-web-research-tools-design.md`.

## Global Constraints

- Repo: `/Users/leathcooper/ai-workspace/harpua`, branch `feat/web-research-tools` (exists; the spec is already committed on it). All paths below are relative to `packages/agent-tools/` unless they start with `/` or `docs/`.
- **Zero new runtime dependencies.** `package.json` dependencies stay absent; peers stay `@langchain/core` + `zod` only. No turndown, no jsdom, no node-fetch.
- **Zod for all runtime validation — never hand-roll type-guard functions.** Function-valued options use `z.custom<T>((v) => typeof v === "function")` (precedent: the repo uses this pattern). Unknown option keys rejected via `.strict()`.
- **Tools never throw past the tool boundary.** Every failure path (network, HTTP status, parse, content-type, size cap, filesystem) returns a string that begins with the tool's name, matching the family style (`read_lines: …`).
- **No bare `new Date()` in logic under test** — `fetch_url` takes an injectable `now: () => Date` (default provider is the only `new Date()`).
- Tests are deterministic and offline: injected `fetchFn`, injected clock, temp dirs via the existing `src/__tests__/tmp-tree.ts` helpers.
- Defaults (exact values from the spec): `maxResults` 5 (ceiling 10), search `timeoutMs` 10_000, fetch `timeoutMs` 15_000, `maxResponseBytes` 2_000_000.
- Content-type policy: `text/html` → convert; `text/plain` → save as-is; `application/pdf` → friendly refusal; anything else → refusal naming the type.
- Re-fetching the same URL overwrites its file (filename = title/URL slug + short URL hash).
- Verification: per-task, run the focused jest spec plus `pnpm --filter @harpua/agent-tools build lint test`; the FINAL task must run the ROOT protocol `pnpm turbo build lint test --force` from the repo root — per-package runs are not sufficient for the finish line.
- A changeset is REQUIRED (publishable package changed): **patch** bump (0.x semantics — features are patches).
- Commits: conventional style, no AI attribution trailers.

---

### Task 1: Options, shared types, and error helper

**Files:**
- Create: `packages/agent-tools/src/web-research/options.ts`
- Create: `packages/agent-tools/src/web-research/errors.ts`
- Test: `packages/agent-tools/src/__tests__/web-research-options.spec.ts`

**Interfaces:**
- Consumes: nothing.
- Produces (later tasks import these exactly):
  - `type FetchFn = (url: string, init?: { signal?: AbortSignal }) => Promise<FetchResponseLike>` where `FetchResponseLike = { ok: boolean; status: number; headers: { get(name: string): string | null }; text(): Promise<string> }`
  - `type SaveDirResolver = (config?: RunnableConfig) => string`
  - `webSearchToolOptionsSchema`, `resolveWebSearchOptions(options)`, types `WebSearchToolOptions` (z.input) / `ResolvedWebSearchToolOptions` (z.output)
  - `fetchUrlToolOptionsSchema`, `resolveFetchUrlOptions(options)`, types `FetchUrlToolOptions` / `ResolvedFetchUrlToolOptions`
  - `webResearchToolsOptionsSchema`, type `WebResearchToolsOptions`
  - Constants: `DEFAULT_MAX_RESULTS`, `MAX_RESULTS_CEILING`, `DEFAULT_SEARCH_TIMEOUT_MS`, `DEFAULT_FETCH_TIMEOUT_MS`, `DEFAULT_MAX_RESPONSE_BYTES`
  - `errorMessage(err: unknown): string` from `errors.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/agent-tools/src/__tests__/web-research-options.spec.ts`:

```ts
import {
  resolveWebSearchOptions,
  resolveFetchUrlOptions,
  DEFAULT_MAX_RESULTS,
  DEFAULT_SEARCH_TIMEOUT_MS,
  DEFAULT_FETCH_TIMEOUT_MS,
  DEFAULT_MAX_RESPONSE_BYTES,
} from "../web-research/options";
import { errorMessage } from "../web-research/errors";

describe("web-research options", () => {
  it("applies web_search defaults with only baseUrl given", () => {
    const opts = resolveWebSearchOptions({ baseUrl: "http://localhost:8080" });
    expect(opts.baseUrl).toBe("http://localhost:8080");
    expect(opts.maxResults).toBe(DEFAULT_MAX_RESULTS);
    expect(opts.timeoutMs).toBe(DEFAULT_SEARCH_TIMEOUT_MS);
    expect(typeof opts.fetchFn).toBe("function");
  });

  it("rejects maxResults over the ceiling and unknown keys", () => {
    expect(() =>
      resolveWebSearchOptions({ baseUrl: "http://x", maxResults: 11 }),
    ).toThrow();
    expect(() =>
      resolveWebSearchOptions({ baseUrl: "http://x", nope: 1 } as never),
    ).toThrow();
  });

  it("applies fetch_url defaults and accepts saveDir as string or function", () => {
    const withString = resolveFetchUrlOptions({ saveDir: "/tmp/x" });
    expect(withString.timeoutMs).toBe(DEFAULT_FETCH_TIMEOUT_MS);
    expect(withString.maxResponseBytes).toBe(DEFAULT_MAX_RESPONSE_BYTES);
    expect(typeof withString.now).toBe("function");
    expect(withString.now()).toBeInstanceOf(Date);

    const resolver = () => "/tmp/y";
    const withFn = resolveFetchUrlOptions({ saveDir: resolver });
    expect(withFn.saveDir).toBe(resolver);
  });

  it("rejects a missing saveDir and non-function fetchFn", () => {
    expect(() => resolveFetchUrlOptions({} as never)).toThrow();
    expect(() =>
      resolveFetchUrlOptions({ saveDir: "/tmp/x", fetchFn: "nope" } as never),
    ).toThrow();
  });
});

describe("errorMessage", () => {
  it("uses .message for Errors and String() otherwise", () => {
    expect(errorMessage(new Error("boom"))).toBe("boom");
    expect(errorMessage("plain")).toBe("plain");
    expect(errorMessage(42)).toBe("42");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @harpua/agent-tools exec jest web-research-options`
Expected: FAIL — cannot find module `../web-research/options`.

- [ ] **Step 3: Write `errors.ts`**

Create `packages/agent-tools/src/web-research/errors.ts`:

```ts
/** Render an unknown thrown value as a short human-readable message. */
export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
```

- [ ] **Step 4: Write `options.ts`**

Create `packages/agent-tools/src/web-research/options.ts`:

```ts
import type { RunnableConfig } from "@langchain/core/runnables";
import { z } from "zod";

/** Sane default number of results included in a web_search reply. */
export const DEFAULT_MAX_RESULTS = 5;
/** Hard ceiling on web_search results regardless of configuration. */
export const MAX_RESULTS_CEILING = 10;
/** Sane default timeout for a web_search request. */
export const DEFAULT_SEARCH_TIMEOUT_MS = 10_000;
/** Sane default timeout for a fetch_url request. */
export const DEFAULT_FETCH_TIMEOUT_MS = 15_000;
/** Sane default response-size ceiling for fetch_url (bytes). */
export const DEFAULT_MAX_RESPONSE_BYTES = 2_000_000;

/** The response surface the web tools read. A WHATWG `Response` fits. */
export interface FetchResponseLike {
  ok: boolean;
  status: number;
  headers: { get(name: string): string | null };
  text(): Promise<string>;
}

/** Minimal fetch the web tools need; `globalThis.fetch` fits. Injectable for tests. */
export type FetchFn = (
  url: string,
  init?: { signal?: AbortSignal },
) => Promise<FetchResponseLike>;

/** Resolves the save directory at call time (receives the tool's run config). */
export type SaveDirResolver = (config?: RunnableConfig) => string;

const fetchFnSchema = z.custom<FetchFn>(
  (v) => typeof v === "function",
  "fetchFn must be a function",
);
const clockSchema = z.custom<() => Date>(
  (v) => typeof v === "function",
  "now must be a function",
);
const saveDirResolverSchema = z.custom<SaveDirResolver>(
  (v) => typeof v === "function",
  "saveDir must be a string or a function",
);

const defaultFetchFn = (): FetchFn => globalThis.fetch as unknown as FetchFn;

/**
 * Options for {@link webSearchTool}. `baseUrl` is the SearXNG instance; every
 * cap has a bounded, context-safe default. Unknown keys are rejected so typos
 * surface immediately.
 */
export const webSearchToolOptionsSchema = z
  .object({
    /** SearXNG instance base URL, e.g. "http://localhost:8080". */
    baseUrl: z.string().min(1),
    /** Results included in the reply (hard-capped at {@link MAX_RESULTS_CEILING}). */
    maxResults: z
      .number()
      .int()
      .positive()
      .max(MAX_RESULTS_CEILING)
      .default(DEFAULT_MAX_RESULTS),
    /** Abort the search request after this many milliseconds. */
    timeoutMs: z.number().int().positive().default(DEFAULT_SEARCH_TIMEOUT_MS),
    /** Injectable fetch (deterministic tests); defaults to globalThis.fetch. */
    fetchFn: fetchFnSchema.default(defaultFetchFn),
  })
  .strict();

export type WebSearchToolOptions = z.input<typeof webSearchToolOptionsSchema>;
export type ResolvedWebSearchToolOptions = z.output<typeof webSearchToolOptionsSchema>;

/** Parse + default web_search options, throwing a zod error on invalid shape. */
export function resolveWebSearchOptions(
  options: WebSearchToolOptions,
): ResolvedWebSearchToolOptions {
  return webSearchToolOptionsSchema.parse(options);
}

/**
 * Options for {@link fetchUrlTool}. `saveDir` is where fetched pages land —
 * a string, or a function of the run config so apps can resolve per-thread
 * directories. Unknown keys are rejected.
 */
export const fetchUrlToolOptionsSchema = z
  .object({
    /** Directory saved pages are written to (string or per-call resolver). */
    saveDir: z.union([z.string().min(1), saveDirResolverSchema]),
    /** Refuse responses larger than this many bytes. */
    maxResponseBytes: z
      .number()
      .int()
      .positive()
      .default(DEFAULT_MAX_RESPONSE_BYTES),
    /** Abort the fetch after this many milliseconds. */
    timeoutMs: z.number().int().positive().default(DEFAULT_FETCH_TIMEOUT_MS),
    /** Injectable fetch (deterministic tests); defaults to globalThis.fetch. */
    fetchFn: fetchFnSchema.default(defaultFetchFn),
    /** Injectable clock for the frontmatter `fetched` date. */
    now: clockSchema.default(() => () => new Date()),
  })
  .strict();

export type FetchUrlToolOptions = z.input<typeof fetchUrlToolOptionsSchema>;
export type ResolvedFetchUrlToolOptions = z.output<typeof fetchUrlToolOptionsSchema>;

/** Parse + default fetch_url options, throwing a zod error on invalid shape. */
export function resolveFetchUrlOptions(
  options: FetchUrlToolOptions,
): ResolvedFetchUrlToolOptions {
  return fetchUrlToolOptionsSchema.parse(options);
}

/**
 * Options for the {@link webResearchTools} bundle: the union of both tools'
 * options — `baseUrl` and `saveDir` required, one `timeoutMs`/`fetchFn`
 * applying to both tools when given.
 */
export const webResearchToolsOptionsSchema = z
  .object({
    baseUrl: z.string().min(1),
    saveDir: z.union([z.string().min(1), saveDirResolverSchema]),
    maxResults: z.number().int().positive().max(MAX_RESULTS_CEILING).optional(),
    maxResponseBytes: z.number().int().positive().optional(),
    timeoutMs: z.number().int().positive().optional(),
    fetchFn: fetchFnSchema.optional(),
    now: clockSchema.optional(),
  })
  .strict();

export type WebResearchToolsOptions = z.input<typeof webResearchToolsOptionsSchema>;
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @harpua/agent-tools exec jest web-research-options`
Expected: PASS (6 tests). Note on `.default(defaultFetchFn)`: zod calls a function default as a factory, so the resolved default IS `globalThis.fetch`; same trick nests once more for `now`.

- [ ] **Step 6: Package build + lint + full package tests**

Run: `pnpm --filter @harpua/agent-tools build lint test`
Expected: all pass (existing suites unaffected).

- [ ] **Step 7: Commit**

```bash
git add packages/agent-tools/src/web-research/ packages/agent-tools/src/__tests__/web-research-options.spec.ts
git commit -m "feat(agent-tools): web-research option schemas and error helper"
```

---

### Task 2: Built-in HTML→markdown extractor

**Files:**
- Create: `packages/agent-tools/src/web-research/html-to-markdown.ts`
- Test: `packages/agent-tools/src/__tests__/html-to-markdown.spec.ts`

**Interfaces:**
- Consumes: nothing (pure function, no I/O, no options).
- Produces: `htmlToMarkdown(html: string): { title?: string; markdown: string }` and `decodeEntities(text: string): string`.

- [ ] **Step 1: Write the failing test**

Create `packages/agent-tools/src/__tests__/html-to-markdown.spec.ts`:

```ts
import { htmlToMarkdown, decodeEntities } from "../web-research/html-to-markdown";

describe("decodeEntities", () => {
  it("decodes named, decimal, and hex entities and leaves unknowns alone", () => {
    expect(decodeEntities("a &amp; b &lt;c&gt; &#176; &#x2126; &bogus;")).toBe(
      "a & b <c> ° Ω &bogus;",
    );
  });
});

describe("htmlToMarkdown", () => {
  it("captures the title and converts headings, paragraphs, links, and lists", () => {
    const html = [
      "<html><head><title>LM317 &amp; Friends</title>",
      "<style>body{color:red}</style><script>alert(1)</script></head>",
      "<body><h1>LM317</h1>",
      "<p>An <a href=\"https://ti.com/lm317\">adjustable regulator</a>.</p>",
      "<h2>Specs</h2>",
      "<ul><li>Dropout: 1.5 V</li><li>Package: TO-220</li></ul>",
      "</body></html>",
    ].join("\n");
    const { title, markdown } = htmlToMarkdown(html);
    expect(title).toBe("LM317 & Friends");
    expect(markdown).toContain("# LM317");
    expect(markdown).toContain("[adjustable regulator](https://ti.com/lm317)");
    expect(markdown).toContain("## Specs");
    expect(markdown).toContain("- Dropout: 1.5 V");
    expect(markdown).toContain("- Package: TO-220");
    expect(markdown).not.toContain("alert(1)");
    expect(markdown).not.toContain("color:red");
  });

  it("protects pre blocks so code angle brackets survive tag stripping", () => {
    const html =
      "<body><pre><code>if (a &lt; b && b > c) {}</code></pre><p>after</p></body>";
    const { markdown } = htmlToMarkdown(html);
    expect(markdown).toContain("```");
    expect(markdown).toContain("if (a < b && b > c) {}");
    expect(markdown).toContain("after");
  });

  it("converts inline code and best-effort tables", () => {
    const html = [
      "<p>Use <code>add_spec</code>.</p>",
      "<table><tr><th>Key</th><th>Value</th></tr>",
      "<tr><td>Dropout</td><td>1.5 V</td></tr></table>",
    ].join("");
    const { markdown } = htmlToMarkdown(html);
    expect(markdown).toContain("`add_spec`");
    expect(markdown).toContain("| Key | Value |");
    expect(markdown).toContain("| Dropout | 1.5 V |");
  });

  it("collapses blank-line runs and trims the result", () => {
    const html = "<div><p>a</p></div>\n\n\n<div><div><p>b</p></div></div>";
    const { markdown } = htmlToMarkdown(html);
    expect(markdown).toBe("a\n\nb");
  });

  it("handles pathological input without throwing", () => {
    expect(htmlToMarkdown("").markdown).toBe("");
    expect(htmlToMarkdown("<h1>unclosed").markdown).toContain("# unclosed");
    expect(htmlToMarkdown("plain text, no tags").markdown).toBe(
      "plain text, no tags",
    );
    expect(htmlToMarkdown("<body><h1></h1></body>").title).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @harpua/agent-tools exec jest html-to-markdown`
Expected: FAIL — cannot find module.

- [ ] **Step 3: Write the extractor**

Create `packages/agent-tools/src/web-research/html-to-markdown.ts`:

```ts
/*
 * Dependency-free HTML → markdown extraction. The goal is ripgrep-able text
 * for agents (headings, lists, links, code, best-effort tables) — NOT
 * rendering fidelity. Upgradeable later without changing the tool contract.
 */

/** The named entities worth decoding without a library (plus numeric forms). */
const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  mdash: "—",
  ndash: "–",
  hellip: "…",
  copy: "©",
  reg: "®",
  trade: "™",
  deg: "°",
  micro: "µ",
  plusmn: "±",
  times: "×",
  divide: "÷",
};

function safeFromCodePoint(code: number): string {
  try {
    return String.fromCodePoint(code);
  } catch {
    return "";
  }
}

/** Decode numeric (dec/hex) and common named HTML entities; unknowns pass through. */
export function decodeEntities(text: string): string {
  return text
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) =>
      safeFromCodePoint(parseInt(hex, 16)),
    )
    .replace(/&#(\d+);/g, (_, dec: string) =>
      safeFromCodePoint(parseInt(dec, 10)),
    )
    .replace(
      /&([a-z]+);/gi,
      (match, name: string) => NAMED_ENTITIES[name.toLowerCase()] ?? match,
    );
}

/** Strip any tags remaining in an inline fragment and decode its entities. */
function inlineText(fragment: string): string {
  return decodeEntities(fragment.replace(/<[^>]*>/g, "")).replace(/\s+/g, " ").trim();
}

export interface HtmlToMarkdownResult {
  /** Decoded <title> text, when present and non-empty. */
  title?: string;
  /** The extracted markdown (trimmed; blank-line runs collapsed). */
  markdown: string;
}

/**
 * Convert an HTML document (or fragment) to searchable markdown. Drops
 * script/style/noscript/head/comments, protects `<pre>` content from tag
 * stripping via placeholders, converts headings/lists/links/code/tables,
 * decodes entities, and collapses whitespace.
 */
export function htmlToMarkdown(html: string): HtmlToMarkdownResult {
  const titleMatch = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  const titleText = titleMatch ? inlineText(titleMatch[1]) : "";
  const title = titleText.length > 0 ? titleText : undefined;

  let work = html
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<head[^>]*>[\s\S]*?<\/head>/gi, "")
    .replace(/<(script|style|noscript)[^>]*>[\s\S]*?<\/\1>/gi, "");

  // Protect <pre> blocks: their content may contain literal < and > that the
  // global tag-strip below would otherwise eat.
  const preBlocks: string[] = [];
  work = work.replace(/<pre[^>]*>([\s\S]*?)<\/pre>/gi, (_, inner: string) => {
    const text = decodeEntities(inner.replace(/<[^>]*>/g, "")).replace(
      /^\n+|\n+$/g,
      "",
    );
    preBlocks.push("```\n" + text + "\n```");
    return `\n\n@@PRE${preBlocks.length - 1}@@\n\n`;
  });

  work = work
    // Inline code before generic stripping so backticks wrap the content.
    .replace(/<code[^>]*>([\s\S]*?)<\/code>/gi, (_, inner: string) => {
      const text = inlineText(inner);
      return text.length > 0 ? `\`${text}\`` : "";
    })
    // Links: [text](href). Ignore anchors without an href.
    .replace(
      /<a\s[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi,
      (_, href: string, inner: string) => {
        const text = inlineText(inner);
        return text.length > 0 ? `[${text}](${href})` : "";
      },
    )
    // Headings h1–h6.
    .replace(
      /<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi,
      (_, level: string, inner: string) => {
        const text = inlineText(inner);
        return text.length > 0
          ? `\n\n${"#".repeat(Number(level))} ${text}\n\n`
          : "\n\n";
      },
    )
    // List items become bullets (ol and ul alike; nesting flattens).
    .replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, (_, inner: string) => {
      const text = inlineText(inner);
      return text.length > 0 ? `\n- ${text}` : "";
    })
    // Best-effort tables: each row becomes a pipe row.
    .replace(/<tr[^>]*>([\s\S]*?)<\/tr>/gi, (_, inner: string) => {
      const cells = [...inner.matchAll(/<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/gi)].map(
        (m) => inlineText(m[1]),
      );
      return cells.length > 0 ? `\n| ${cells.join(" | ")} |` : "";
    })
    // Paragraph-ish boundaries become blank lines; <br> a newline.
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/?(p|div|section|article|table|ul|ol|blockquote|tbody|thead|main|header|footer|nav|aside|figure)[^>]*>/gi, "\n\n");

  // Strip every remaining tag, decode entities, restore protected pre blocks.
  work = decodeEntities(work.replace(/<[^>]*>/g, ""));
  work = work.replace(/@@PRE(\d+)@@/g, (_, i: string) => preBlocks[Number(i)]);

  // Normalize whitespace: trim line ends, collapse 3+ newlines to 2, trim.
  const markdown = work
    .split("\n")
    .map((line) => line.replace(/[ \t]+$/g, "").replace(/^[ \t]+/g, ""))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return { title, markdown };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @harpua/agent-tools exec jest html-to-markdown`
Expected: PASS (5 tests). If the "collapses blank-line runs" test fails, diff the actual string — the usual culprits are leading spaces surviving on lines or a stray blank at the start.

- [ ] **Step 5: Package build + lint + full package tests**

Run: `pnpm --filter @harpua/agent-tools build lint test`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add packages/agent-tools/src/web-research/html-to-markdown.ts packages/agent-tools/src/__tests__/html-to-markdown.spec.ts
git commit -m "feat(agent-tools): dependency-free HTML to markdown extractor"
```

---

### Task 3: `web_search` tool

**Files:**
- Create: `packages/agent-tools/src/web-research/web-search.ts`
- Test: `packages/agent-tools/src/__tests__/web-search.spec.ts`

**Interfaces:**
- Consumes: `resolveWebSearchOptions`, `WebSearchToolOptions`, `FetchFn`, `FetchResponseLike` (Task 1); `errorMessage` (Task 1); `runTool` from `../__tests__/tmp-tree` (existing helper).
- Produces: `webSearchTool(options: WebSearchToolOptions): StructuredToolInterface` — tool name `web_search`, input `{ query: string }`.

- [ ] **Step 1: Write the failing test**

Create `packages/agent-tools/src/__tests__/web-search.spec.ts`:

```ts
import { webSearchTool } from "../web-research/web-search";
import type { FetchFn, FetchResponseLike } from "../web-research/options";
import { runTool } from "./tmp-tree";

function jsonResponse(body: unknown, status = 200): FetchResponseLike {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => "application/json" },
    text: async () => JSON.stringify(body),
  };
}

const THREE_RESULTS = {
  results: [
    { title: "LM317 datasheet", url: "https://ti.com/lm317", content: "Adjustable regulator." },
    { title: "LM317 calculator", url: "https://example.com/calc" },
    { title: "LM317 thread", url: "https://forum.example.com/t/1", content: "Use 240R." },
  ],
};

describe("web_search", () => {
  it("formats a numbered list with title, url, and snippet when present", async () => {
    const fetchFn: FetchFn = async () => jsonResponse(THREE_RESULTS);
    const tool = webSearchTool({ baseUrl: "http://searx.local", fetchFn });
    const out = await runTool(tool, { query: "LM317" });
    expect(out).toContain("1. LM317 datasheet");
    expect(out).toContain("https://ti.com/lm317");
    expect(out).toContain("Adjustable regulator.");
    expect(out).toContain("2. LM317 calculator");
    expect(out).toContain("3. LM317 thread");
  });

  it("caps results at maxResults and URL-encodes the query", async () => {
    const seen: string[] = [];
    const fetchFn: FetchFn = async (url) => {
      seen.push(url);
      return jsonResponse(THREE_RESULTS);
    };
    const tool = webSearchTool({ baseUrl: "http://searx.local", maxResults: 2, fetchFn });
    const out = await runTool(tool, { query: "LM317 dropout & load" });
    expect(out).toContain("2. LM317 calculator");
    expect(out).not.toContain("3. LM317 thread");
    expect(seen[0]).toBe(
      "http://searx.local/search?q=LM317%20dropout%20%26%20load&format=json",
    );
  });

  it("strips a trailing slash from baseUrl", async () => {
    const seen: string[] = [];
    const fetchFn: FetchFn = async (url) => {
      seen.push(url);
      return jsonResponse({ results: [] });
    };
    await runTool(webSearchTool({ baseUrl: "http://searx.local/", fetchFn }), {
      query: "x",
    });
    expect(seen[0]).toContain("http://searx.local/search?");
  });

  it("returns a friendly message for zero results", async () => {
    const fetchFn: FetchFn = async () => jsonResponse({ results: [] });
    const out = await runTool(
      webSearchTool({ baseUrl: "http://searx.local", fetchFn }),
      { query: "xyzzy" },
    );
    expect(out).toMatch(/no results/i);
    expect(out).toContain("xyzzy");
  });

  it("reports non-2xx statuses with the JSON-format hint, without throwing", async () => {
    const fetchFn: FetchFn = async () => jsonResponse({}, 403);
    const out = await runTool(
      webSearchTool({ baseUrl: "http://searx.local", fetchFn }),
      { query: "x" },
    );
    expect(out).toContain("403");
    expect(out).toMatch(/settings\.yml/);
  });

  it("reports network failures and unparseable bodies as strings", async () => {
    const failing: FetchFn = async () => {
      throw new Error("connect ECONNREFUSED");
    };
    const badBody: FetchFn = async () => ({
      ok: true,
      status: 200,
      headers: { get: () => "text/html" },
      text: async () => "<html>not json</html>",
    });
    const out1 = await runTool(
      webSearchTool({ baseUrl: "http://searx.local", fetchFn: failing }),
      { query: "x" },
    );
    const out2 = await runTool(
      webSearchTool({ baseUrl: "http://searx.local", fetchFn: badBody }),
      { query: "x" },
    );
    expect(out1).toContain("ECONNREFUSED");
    expect(out2).toMatch(/unexpected response/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @harpua/agent-tools exec jest web-search`
Expected: FAIL — cannot find module `../web-research/web-search`.

- [ ] **Step 3: Write the tool**

Create `packages/agent-tools/src/web-research/web-search.ts`:

```ts
import { tool } from "@langchain/core/tools";
import type { StructuredToolInterface } from "@langchain/core/tools";
import { z } from "zod";

import {
  resolveWebSearchOptions,
  type WebSearchToolOptions,
} from "./options";
import { errorMessage } from "./errors";

const DESCRIPTION =
  "Search the web (via a SearXNG metasearch instance) and get a numbered " +
  "list of results with title, URL, and snippet. Use it to find pages worth " +
  "reading — then call fetch_url on a result to save the page locally for " +
  "detailed searching and reading. Refine the query and search again rather " +
  "than paging; only the top results are returned.";

const webSearchInputSchema = z.object({
  query: z
    .string()
    .min(1)
    .describe("The search query — specific terms work best, e.g. 'LM317 dropout voltage'."),
});

/** Only the fields we read from a SearXNG JSON response; extras are ignored. */
const searxngResponseSchema = z.object({
  results: z
    .array(
      z.object({
        title: z.string(),
        url: z.string(),
        content: z.string().optional(),
      }),
    )
    .optional(),
});

/**
 * `web_search` — query a SearXNG instance's JSON API and return a numbered
 * result list. Never throws: network errors, non-2xx statuses (with a hint
 * that SearXNG's JSON format must be enabled in settings.yml), unparseable
 * bodies, and empty result sets all come back as friendly strings.
 *
 * The model chooses the queries and typically feeds results to `fetch_url`;
 * publicly-deployed apps should gate that follow-up fetch (e.g. with
 * `requireApproval()` from `@harpua/langgraph`) or front it with an allowlist.
 *
 * @example
 * ```ts
 * import { webSearchTool } from "@harpua/agent-tools";
 *
 * const search = webSearchTool({ baseUrl: process.env.SEARXNG_BASE_URL! });
 * ```
 */
export function webSearchTool(
  options: WebSearchToolOptions,
): StructuredToolInterface {
  const opts = resolveWebSearchOptions(options);
  const base = opts.baseUrl.replace(/\/+$/, "");

  return tool(
    async ({ query }) => {
      const url = `${base}/search?q=${encodeURIComponent(query)}&format=json`;

      let response;
      try {
        response = await opts.fetchFn(url, {
          signal: AbortSignal.timeout(opts.timeoutMs),
        });
      } catch (err) {
        return `web_search: request to the search service failed (${errorMessage(err)}).`;
      }

      if (!response.ok) {
        return (
          `web_search: the search service returned HTTP ${response.status}. ` +
          "If this is a SearXNG instance, make sure the JSON format is enabled " +
          "in settings.yml (search: formats: [html, json])."
        );
      }

      let results;
      try {
        results =
          searxngResponseSchema.parse(JSON.parse(await response.text())).results ?? [];
      } catch {
        return "web_search: the search service returned an unexpected response shape.";
      }

      const shown = results.slice(0, opts.maxResults);
      if (shown.length === 0) {
        return `web_search: no results for "${query}" — try different terms.`;
      }

      return shown
        .map((r, i) => {
          const snippet = r.content ? `\n   ${r.content}` : "";
          return `${i + 1}. ${r.title}\n   ${r.url}${snippet}`;
        })
        .join("\n");
    },
    { name: "web_search", description: DESCRIPTION, schema: webSearchInputSchema },
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @harpua/agent-tools exec jest web-search`
Expected: PASS (6 tests).

- [ ] **Step 5: Package build + lint + full package tests**

Run: `pnpm --filter @harpua/agent-tools build lint test`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add packages/agent-tools/src/web-research/web-search.ts packages/agent-tools/src/__tests__/web-search.spec.ts
git commit -m "feat(agent-tools): SearXNG-backed web_search tool"
```

---

### Task 4: Page saving (slug, hash, frontmatter)

**Files:**
- Create: `packages/agent-tools/src/web-research/save-page.ts`
- Test: `packages/agent-tools/src/__tests__/save-page.spec.ts`

**Interfaces:**
- Consumes: `makeTmpDir`, `removeTmpDir` from `./tmp-tree` (existing).
- Produces (Task 5 imports these exactly):
  - `pageSlug(title: string | undefined, url: URL): string`
  - `savePage(input: { dir: string; url: URL; title?: string; markdown: string; fetched: string }): string` — writes the file, returns its absolute path.

- [ ] **Step 1: Write the failing test**

Create `packages/agent-tools/src/__tests__/save-page.spec.ts`:

```ts
import fs from "node:fs";
import path from "node:path";

import { pageSlug, savePage } from "../web-research/save-page";
import { makeTmpDir, removeTmpDir } from "./tmp-tree";

describe("pageSlug", () => {
  it("slugs the title and appends a stable URL hash", () => {
    const url = new URL("https://ti.com/product/LM317");
    const a = pageSlug("LM317 3-Terminal Regulator!", url);
    const b = pageSlug("LM317 3-Terminal Regulator!", url);
    expect(a).toBe(b);
    expect(a).toMatch(/^lm317-3-terminal-regulator-[0-9a-f]{8}$/);
  });

  it("falls back to host+path when there is no title, and never collides across URLs", () => {
    const a = pageSlug(undefined, new URL("https://ti.com/a"));
    const b = pageSlug(undefined, new URL("https://ti.com/b"));
    expect(a).toMatch(/^ti-com-a-[0-9a-f]{8}$/);
    expect(a).not.toBe(b);
  });

  it("gives same-title pages from different URLs distinct slugs", () => {
    const a = pageSlug("Datasheet", new URL("https://x.com/1"));
    const b = pageSlug("Datasheet", new URL("https://x.com/2"));
    expect(a).not.toBe(b);
  });

  it("never produces path separators or dots from hostile titles", () => {
    const slug = pageSlug("../../etc/passwd", new URL("https://x.com/p"));
    expect(slug).not.toContain("/");
    expect(slug).not.toContain("\\");
    expect(slug).not.toContain("..");
  });
});

describe("savePage", () => {
  let dir: string;
  beforeEach(() => (dir = makeTmpDir()));
  afterEach(() => removeTmpDir(dir));

  it("creates the directory, writes frontmatter + markdown, returns the path", () => {
    const target = path.join(dir, "nested", "sources");
    const saved = savePage({
      dir: target,
      url: new URL("https://ti.com/lm317"),
      title: 'LM317 "quoted"',
      markdown: "# LM317\n\nBody.",
      fetched: "2026-07-08",
    });
    const content = fs.readFileSync(saved, "utf8");
    expect(saved.startsWith(target)).toBe(true);
    expect(content).toContain("---");
    expect(content).toContain("url: https://ti.com/lm317");
    expect(content).toContain('title: "LM317 \\"quoted\\""');
    expect(content).toContain("fetched: 2026-07-08");
    expect(content).toContain("# LM317");
    expect(content.endsWith("\n")).toBe(true);
  });

  it("overwrites on re-save of the same URL (refresh, not duplicate)", () => {
    const url = new URL("https://ti.com/lm317");
    const first = savePage({ dir, url, title: "T", markdown: "old", fetched: "2026-07-07" });
    const second = savePage({ dir, url, title: "T", markdown: "new", fetched: "2026-07-08" });
    expect(second).toBe(first);
    expect(fs.readdirSync(dir)).toHaveLength(1);
    expect(fs.readFileSync(first, "utf8")).toContain("new");
  });

  it("omits the title line when there is no title", () => {
    const saved = savePage({
      dir,
      url: new URL("https://x.com/p"),
      markdown: "body",
      fetched: "2026-07-08",
    });
    expect(fs.readFileSync(saved, "utf8")).not.toContain("title:");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @harpua/agent-tools exec jest save-page`
Expected: FAIL — cannot find module.

- [ ] **Step 3: Write the module**

Create `packages/agent-tools/src/web-research/save-page.ts`:

```ts
import fs from "node:fs";
import path from "node:path";

/** Tiny stable FNV-1a hash — content-independent, dependency-free. */
function urlHash(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

/**
 * Filename slug for a saved page: the page title (fallback: URL host+path),
 * lowercased and reduced to [a-z0-9-], capped at 60 chars, plus a short hash
 * of the full URL so distinct URLs never collide and re-fetching the same URL
 * overwrites its file.
 */
export function pageSlug(title: string | undefined, url: URL): string {
  const source =
    title && title.trim().length > 0 ? title : `${url.host}${url.pathname}`;
  const base =
    source
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60)
      .replace(/-+$/g, "") || "page";
  return `${base}-${urlHash(url.toString())}`;
}

export interface SavePageInput {
  /** Directory to write into (created recursively if missing). */
  dir: string;
  /** The fetched URL (recorded in frontmatter; hashed into the filename). */
  url: URL;
  /** Page title for the frontmatter and slug, when known. */
  title?: string;
  /** The extracted markdown body. */
  markdown: string;
  /** YYYY-MM-DD fetch date for the frontmatter. */
  fetched: string;
}

/**
 * Write a fetched page as `<slug>.md` with YAML frontmatter (url, title,
 * fetched). Returns the absolute path written. Same URL → same path, so a
 * re-fetch refreshes the file instead of duplicating it.
 */
export function savePage(input: SavePageInput): string {
  fs.mkdirSync(input.dir, { recursive: true });
  const file = path.join(input.dir, `${pageSlug(input.title, input.url)}.md`);
  const lines = ["---", `url: ${input.url.toString()}`];
  if (input.title) {
    lines.push(`title: "${input.title.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`);
  }
  lines.push(`fetched: ${input.fetched}`, "---", "", input.markdown, "");
  fs.writeFileSync(file, lines.join("\n"));
  return file;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @harpua/agent-tools exec jest save-page`
Expected: PASS (7 tests).

- [ ] **Step 5: Package build + lint + full package tests**

Run: `pnpm --filter @harpua/agent-tools build lint test`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add packages/agent-tools/src/web-research/save-page.ts packages/agent-tools/src/__tests__/save-page.spec.ts
git commit -m "feat(agent-tools): page saving with slug, URL hash, and frontmatter"
```

---

### Task 5: `fetch_url` tool

**Files:**
- Create: `packages/agent-tools/src/web-research/fetch-url.ts`
- Test: `packages/agent-tools/src/__tests__/fetch-url.spec.ts`

**Interfaces:**
- Consumes: `resolveFetchUrlOptions`, `FetchUrlToolOptions`, `FetchFn`, `FetchResponseLike` (Task 1); `errorMessage` (Task 1); `htmlToMarkdown` (Task 2); `savePage` (Task 4); `makeTmpDir`/`removeTmpDir`/`runTool` (existing helpers).
- Produces: `fetchUrlTool(options: FetchUrlToolOptions): StructuredToolInterface` — tool name `fetch_url`, input `{ url: string }`.

- [ ] **Step 1: Write the failing test**

Create `packages/agent-tools/src/__tests__/fetch-url.spec.ts`:

```ts
import fs from "node:fs";
import path from "node:path";

import type { RunnableConfig } from "@langchain/core/runnables";

import { fetchUrlTool } from "../web-research/fetch-url";
import type { FetchFn, FetchResponseLike } from "../web-research/options";
import { makeTmpDir, removeTmpDir, runTool } from "./tmp-tree";

const FIXED_NOW = () => new Date("2026-07-08T12:00:00Z");

function response(
  body: string,
  contentType: string,
  status = 200,
  contentLength?: number,
): FetchResponseLike {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get: (name: string) => {
        const key = name.toLowerCase();
        if (key === "content-type") return contentType;
        if (key === "content-length" && contentLength !== undefined) {
          return String(contentLength);
        }
        return null;
      },
    },
    text: async () => body,
  };
}

const PAGE =
  "<html><head><title>LM317 Product Page</title></head>" +
  "<body><h1>LM317</h1><p>Dropout voltage 1.5 V typical.</p></body></html>";

describe("fetch_url", () => {
  let dir: string;
  beforeEach(() => (dir = makeTmpDir()));
  afterEach(() => removeTmpDir(dir));

  const htmlFetch: FetchFn = async () => response(PAGE, "text/html; charset=utf-8");

  it("saves an HTML page as markdown with frontmatter and reports the path", async () => {
    const tool = fetchUrlTool({ saveDir: dir, fetchFn: htmlFetch, now: FIXED_NOW });
    const out = await runTool(tool, { url: "https://ti.com/lm317" });

    expect(out).toContain("LM317 Product Page");
    expect(out).toMatch(/search_files|read_lines/);

    const files = fs.readdirSync(dir);
    expect(files).toHaveLength(1);
    const content = fs.readFileSync(path.join(dir, files[0]), "utf8");
    expect(content).toContain("url: https://ti.com/lm317");
    expect(content).toContain("fetched: 2026-07-08");
    expect(content).toContain("# LM317");
    expect(content).toContain("Dropout voltage 1.5 V typical.");
  });

  it("saves text/plain bodies as-is", async () => {
    const plainFetch: FetchFn = async () => response("just text", "text/plain");
    await runTool(
      fetchUrlTool({ saveDir: dir, fetchFn: plainFetch, now: FIXED_NOW }),
      { url: "https://x.com/readme.txt" },
    );
    const files = fs.readdirSync(dir);
    const content = fs.readFileSync(path.join(dir, files[0]), "utf8");
    expect(content).toContain("just text");
  });

  it("refuses PDFs with a friendly message and writes nothing", async () => {
    const pdfFetch: FetchFn = async () => response("%PDF-1.4", "application/pdf");
    const out = await runTool(
      fetchUrlTool({ saveDir: dir, fetchFn: pdfFetch, now: FIXED_NOW }),
      { url: "https://ti.com/lm317.pdf" },
    );
    expect(out).toMatch(/pdf/i);
    expect(out).toMatch(/aren't supported|not supported/i);
    expect(fs.readdirSync(dir)).toHaveLength(0);
  });

  it("refuses other content types naming the type", async () => {
    const imgFetch: FetchFn = async () => response("...", "image/png");
    const out = await runTool(
      fetchUrlTool({ saveDir: dir, fetchFn: imgFetch, now: FIXED_NOW }),
      { url: "https://x.com/logo.png" },
    );
    expect(out).toContain("image/png");
    expect(fs.readdirSync(dir)).toHaveLength(0);
  });

  it("refuses non-http(s) schemes and invalid URLs", async () => {
    const tool = fetchUrlTool({ saveDir: dir, fetchFn: htmlFetch, now: FIXED_NOW });
    expect(await runTool(tool, { url: "file:///etc/passwd" })).toMatch(
      /only http/i,
    );
    expect(await runTool(tool, { url: "not a url" })).toMatch(/not a valid URL/i);
    expect(fs.readdirSync(dir)).toHaveLength(0);
  });

  it("refuses oversize responses — via content-length pre-check and via body size", async () => {
    const declared: FetchFn = async () =>
      response(PAGE, "text/html", 200, 9_999_999);
    const out1 = await runTool(
      fetchUrlTool({ saveDir: dir, fetchFn: declared, now: FIXED_NOW }),
      { url: "https://x.com/big" },
    );
    expect(out1).toMatch(/bytes/);

    const undeclared: FetchFn = async () => response("x".repeat(2000), "text/html");
    const out2 = await runTool(
      fetchUrlTool({
        saveDir: dir,
        maxResponseBytes: 1000,
        fetchFn: undeclared,
        now: FIXED_NOW,
      }),
      { url: "https://x.com/big2" },
    );
    expect(out2).toMatch(/bytes/);
    expect(fs.readdirSync(dir)).toHaveLength(0);
  });

  it("reports non-2xx and network failures as strings", async () => {
    const notFound: FetchFn = async () => response("nope", "text/html", 404);
    const failing: FetchFn = async () => {
      throw new Error("getaddrinfo ENOTFOUND");
    };
    const out1 = await runTool(
      fetchUrlTool({ saveDir: dir, fetchFn: notFound, now: FIXED_NOW }),
      { url: "https://x.com/missing" },
    );
    const out2 = await runTool(
      fetchUrlTool({ saveDir: dir, fetchFn: failing, now: FIXED_NOW }),
      { url: "https://x.com/down" },
    );
    expect(out1).toContain("404");
    expect(out2).toContain("ENOTFOUND");
  });

  it("resolves saveDir as a function of the run config (per-thread dirs)", async () => {
    const seen: Array<RunnableConfig | undefined> = [];
    const tool = fetchUrlTool({
      saveDir: (config) => {
        seen.push(config);
        const thread = (config?.configurable as { thread_id?: string } | undefined)
          ?.thread_id;
        return path.join(dir, thread ?? "default");
      },
      fetchFn: htmlFetch,
      now: FIXED_NOW,
    });
    await tool.invoke(
      { url: "https://ti.com/lm317" },
      { configurable: { thread_id: "buck-v1" } },
    );
    expect(seen).toHaveLength(1);
    expect(fs.readdirSync(path.join(dir, "buck-v1"))).toHaveLength(1);
  });

  it("returns a filesystem failure as a friendly string", async () => {
    const filePath = path.join(dir, "not-a-dir");
    fs.writeFileSync(filePath, "occupied");
    const out = await runTool(
      fetchUrlTool({ saveDir: filePath, fetchFn: htmlFetch, now: FIXED_NOW }),
      { url: "https://ti.com/lm317" },
    );
    expect(out).toMatch(/could not save/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @harpua/agent-tools exec jest fetch-url`
Expected: FAIL — cannot find module.

- [ ] **Step 3: Write the tool**

Create `packages/agent-tools/src/web-research/fetch-url.ts`:

```ts
import { tool } from "@langchain/core/tools";
import type { StructuredToolInterface } from "@langchain/core/tools";
import type { RunnableConfig } from "@langchain/core/runnables";
import { z } from "zod";

import {
  resolveFetchUrlOptions,
  type FetchUrlToolOptions,
} from "./options";
import { errorMessage } from "./errors";
import { htmlToMarkdown } from "./html-to-markdown";
import { savePage } from "./save-page";

const DESCRIPTION =
  "Fetch a web page and save it locally as markdown so it can be searched " +
  "and read. Give it a URL (from web_search results or the user); it " +
  "converts HTML to markdown, saves the file, and tells you the saved path. " +
  "Then use search_files to find terms in it and read_lines to read it. " +
  "HTML and plain-text pages only — PDFs and other binary types are refused. " +
  "SECURITY: this fetches whatever URL is supplied; publicly-deployed apps " +
  "should gate it (e.g. requireApproval) or front it with an allowlist.";

const fetchUrlInputSchema = z.object({
  url: z.string().min(1).describe("The absolute http(s) URL of the page to fetch."),
});

/**
 * `fetch_url` — fetch an HTML or plain-text page, convert HTML to markdown
 * via the built-in extractor, and save it (with url/title/fetched
 * frontmatter) into `saveDir`. `saveDir` may be a function of the run config
 * so apps can resolve per-thread directories. Never throws: bad schemes,
 * network errors, non-2xx statuses, refused content types, oversize bodies,
 * and filesystem failures all come back as friendly strings.
 *
 * @example
 * ```ts
 * import { fetchUrlTool } from "@harpua/agent-tools";
 *
 * const fetchUrl = fetchUrlTool({ saveDir: "./sources" });
 * ```
 */
export function fetchUrlTool(
  options: FetchUrlToolOptions,
): StructuredToolInterface {
  const opts = resolveFetchUrlOptions(options);

  return tool(
    async ({ url: input }, config?: RunnableConfig) => {
      let url: URL;
      try {
        url = new URL(input);
      } catch {
        return `fetch_url: "${input}" is not a valid URL.`;
      }
      if (url.protocol !== "http:" && url.protocol !== "https:") {
        return `fetch_url: only http(s) URLs are supported (got "${url.protocol}").`;
      }

      let response;
      try {
        response = await opts.fetchFn(url.toString(), {
          signal: AbortSignal.timeout(opts.timeoutMs),
        });
      } catch (err) {
        return `fetch_url: request failed (${errorMessage(err)}).`;
      }

      if (!response.ok) {
        return `fetch_url: ${url.toString()} returned HTTP ${response.status}.`;
      }

      const contentType = (response.headers.get("content-type") ?? "").toLowerCase();
      if (contentType.includes("application/pdf")) {
        return (
          `fetch_url: ${url.toString()} is a PDF — PDFs aren't supported yet; ` +
          "only HTML and plain-text pages can be saved."
        );
      }
      const isHtml = contentType.includes("text/html");
      const isPlain = contentType.includes("text/plain");
      if (!isHtml && !isPlain) {
        return (
          `fetch_url: unsupported content type "${contentType || "unknown"}" — ` +
          "only text/html and text/plain pages are saved."
        );
      }

      const declared = Number(response.headers.get("content-length") ?? "");
      if (Number.isFinite(declared) && declared > opts.maxResponseBytes) {
        return (
          `fetch_url: response is ${declared} bytes, over the ` +
          `${opts.maxResponseBytes}-byte limit.`
        );
      }

      let body: string;
      try {
        body = await response.text();
      } catch (err) {
        return `fetch_url: could not read the response body (${errorMessage(err)}).`;
      }
      const bytes = Buffer.byteLength(body, "utf8");
      if (bytes > opts.maxResponseBytes) {
        return (
          `fetch_url: response is ${bytes} bytes, over the ` +
          `${opts.maxResponseBytes}-byte limit.`
        );
      }

      const { title, markdown } = isHtml
        ? htmlToMarkdown(body)
        : { title: undefined, markdown: body };

      const dir =
        typeof opts.saveDir === "function" ? opts.saveDir(config) : opts.saveDir;
      const fetched = opts.now().toISOString().slice(0, 10);

      let saved: string;
      try {
        saved = savePage({ dir, url, title, markdown, fetched });
      } catch (err) {
        return `fetch_url: could not save the page (${errorMessage(err)}).`;
      }

      const lineCount = markdown.split("\n").length;
      const label = title ?? `${url.host}${url.pathname}`;
      return (
        `Saved "${label}" (${lineCount} lines) to ${saved}.\n` +
        "Search it with search_files or read it with read_lines."
      );
    },
    { name: "fetch_url", description: DESCRIPTION, schema: fetchUrlInputSchema },
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @harpua/agent-tools exec jest fetch-url`
Expected: PASS (9 tests). If the saveDir-as-function test fails on the config argument, check how the installed `@langchain/core` version passes config to `tool()` executors (second parameter of the callback) — do not weaken the test; the runtime facade depends on this exact mechanism.

- [ ] **Step 5: Package build + lint + full package tests**

Run: `pnpm --filter @harpua/agent-tools build lint test`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add packages/agent-tools/src/web-research/fetch-url.ts packages/agent-tools/src/__tests__/fetch-url.spec.ts
git commit -m "feat(agent-tools): fetch_url tool saving pages as searchable markdown"
```

---

### Task 6: Bundle, exports, and the closing-the-loop integration test

**Files:**
- Create: `packages/agent-tools/src/web-research/web-research-tools.ts`
- Modify: `packages/agent-tools/src/index.ts` (append exports)
- Test: `packages/agent-tools/src/__tests__/web-research-tools.spec.ts`

**Interfaces:**
- Consumes: `webSearchTool` (Task 3), `fetchUrlTool` (Task 5), `webResearchToolsOptionsSchema`/`WebResearchToolsOptions` (Task 1), `fileExplorationTools` (existing), test helpers.
- Produces: `webResearchTools(options: WebResearchToolsOptions): StructuredToolInterface[]`, and the package's public exports for the whole family.

- [ ] **Step 1: Write the failing test**

Create `packages/agent-tools/src/__tests__/web-research-tools.spec.ts`:

```ts
import fs from "node:fs";
import path from "node:path";

import { webResearchTools } from "../web-research/web-research-tools";
import { fileExplorationTools } from "../file-exploration/file-exploration-tools";
import type { FetchFn, FetchResponseLike } from "../web-research/options";
import { makeTmpDir, removeTmpDir, runTool } from "./tmp-tree";

const FIXED_NOW = () => new Date("2026-07-08T12:00:00Z");

const PAGE =
  "<html><head><title>LM317 Page</title></head>" +
  "<body><h1>LM317</h1><p>Dropout voltage 1.5 V typical.</p></body></html>";

function fetchFor(searchBody: unknown): FetchFn {
  return async (url: string): Promise<FetchResponseLike> => {
    const isSearch = url.includes("/search?");
    return {
      ok: true,
      status: 200,
      headers: {
        get: (name: string) =>
          name.toLowerCase() === "content-type"
            ? isSearch
              ? "application/json"
              : "text/html"
            : null,
      },
      text: async () => (isSearch ? JSON.stringify(searchBody) : PAGE),
    };
  };
}

describe("webResearchTools bundle", () => {
  let dir: string;
  beforeEach(() => (dir = makeTmpDir()));
  afterEach(() => removeTmpDir(dir));

  it("returns web_search and fetch_url sharing one options object", async () => {
    const tools = webResearchTools({
      baseUrl: "http://searx.local",
      saveDir: dir,
      fetchFn: fetchFor({
        results: [{ title: "LM317", url: "https://ti.com/lm317" }],
      }),
      now: FIXED_NOW,
    });
    expect(tools.map((t) => t.name)).toEqual(["web_search", "fetch_url"]);

    const searchOut = await runTool(tools[0], { query: "LM317" });
    expect(searchOut).toContain("https://ti.com/lm317");

    const fetchOut = await runTool(tools[1], { url: "https://ti.com/lm317" });
    expect(fetchOut).toContain("LM317 Page");
  });

  it("rejects unknown keys and missing required options", () => {
    expect(() =>
      webResearchTools({ baseUrl: "http://x" } as never),
    ).toThrow();
    expect(() =>
      webResearchTools({
        baseUrl: "http://x",
        saveDir: "/tmp/x",
        bogus: 1,
      } as never),
    ).toThrow();
  });

  it("closes the loop: a fetched page is findable with fileExplorationTools", async () => {
    const tools = webResearchTools({
      baseUrl: "http://searx.local",
      saveDir: dir,
      fetchFn: fetchFor({ results: [] }),
      now: FIXED_NOW,
    });
    await runTool(tools[1], { url: "https://ti.com/lm317" });

    const [searchFiles] = fileExplorationTools({ root: dir });
    const found = await runTool(searchFiles, { pattern: "Dropout voltage" });
    expect(found).toContain("Dropout voltage 1.5 V typical.");
    expect(found).toMatch(/\.md/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @harpua/agent-tools exec jest web-research-tools`
Expected: FAIL — cannot find module `../web-research/web-research-tools`.
Note: the closing-the-loop test needs ripgrep on PATH (the existing `search-code.spec.ts` already depends on it, so the environment has it).

- [ ] **Step 3: Write the bundle**

Create `packages/agent-tools/src/web-research/web-research-tools.ts`:

```ts
import type { StructuredToolInterface } from "@langchain/core/tools";

import { webSearchTool } from "./web-search";
import { fetchUrlTool } from "./fetch-url";
import {
  webResearchToolsOptionsSchema,
  type WebResearchToolsOptions,
} from "./options";

/**
 * The web-research tool family: `web_search` (SearXNG-backed) and `fetch_url`
 * (fetch → markdown → save), sharing one options object. Fetched pages land
 * in `saveDir` as frontmattered markdown — pair with `fileExplorationTools`
 * jailed to the same directory so the agent can search and read what it
 * saved. Their descriptions teach the workflow: search, fetch, then explore.
 *
 * This bundle is the primary API; the individual factories are exported too.
 *
 * @example
 * ```ts
 * import { webResearchTools, fileExplorationTools } from "@harpua/agent-tools";
 * import { ToolNode } from "@langchain/langgraph/prebuilt";
 *
 * const sources = "./sources";
 * const toolNode = new ToolNode([
 *   ...webResearchTools({ baseUrl: "http://localhost:8080", saveDir: sources }),
 *   ...fileExplorationTools({ root: sources }),
 * ]);
 * ```
 */
export function webResearchTools(
  options: WebResearchToolsOptions,
): StructuredToolInterface[] {
  const opts = webResearchToolsOptionsSchema.parse(options);
  return [
    webSearchTool({
      baseUrl: opts.baseUrl,
      ...(opts.maxResults !== undefined && { maxResults: opts.maxResults }),
      ...(opts.timeoutMs !== undefined && { timeoutMs: opts.timeoutMs }),
      ...(opts.fetchFn !== undefined && { fetchFn: opts.fetchFn }),
    }),
    fetchUrlTool({
      saveDir: opts.saveDir,
      ...(opts.maxResponseBytes !== undefined && {
        maxResponseBytes: opts.maxResponseBytes,
      }),
      ...(opts.timeoutMs !== undefined && { timeoutMs: opts.timeoutMs }),
      ...(opts.fetchFn !== undefined && { fetchFn: opts.fetchFn }),
      ...(opts.now !== undefined && { now: opts.now }),
    }),
  ];
}
```

- [ ] **Step 4: Append exports to `src/index.ts`**

Add at the end of `packages/agent-tools/src/index.ts` (keep the existing content untouched):

```ts
// Web-research family: web_search (SearXNG-backed) and fetch_url (fetch →
// markdown → save). Saved pages pair with fileExplorationTools jailed to the
// same directory. The bundle is the primary API; factories exported for
// one-off use.
export { webResearchTools } from "./web-research/web-research-tools";
export { webSearchTool } from "./web-research/web-search";
export { fetchUrlTool } from "./web-research/fetch-url";
export type {
  WebSearchToolOptions,
  FetchUrlToolOptions,
  WebResearchToolsOptions,
  FetchFn,
  SaveDirResolver,
} from "./web-research/options";
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @harpua/agent-tools exec jest web-research-tools`
Expected: PASS (3 tests).

- [ ] **Step 6: Package build + lint + full package tests**

Run: `pnpm --filter @harpua/agent-tools build lint test`
Expected: all pass (whole package: existing + 5 new suites).

- [ ] **Step 7: Commit**

```bash
git add packages/agent-tools/src/web-research/web-research-tools.ts packages/agent-tools/src/index.ts packages/agent-tools/src/__tests__/web-research-tools.spec.ts
git commit -m "feat(agent-tools): webResearchTools bundle and public exports"
```

---

### Task 7: README, changeset, and ROOT-protocol verification

**Files:**
- Modify: `packages/agent-tools/README.md` (new subsection under `## Tools`)
- Create: `.changeset/web-research-tools.md` (repo root)

**Interfaces:**
- Consumes: everything shipped in Tasks 1–6.
- Produces: docs + the release artifact; the verified finish line.

- [ ] **Step 1: Add the README section**

Read `packages/agent-tools/README.md` first to match its heading levels and voice exactly (the `## Tools` section documents `think` and the file-exploration family). Append a sibling subsection after the file-exploration docs:

```markdown
### Web research — `web_search` + `fetch_url`

Search the web through a [SearXNG](https://docs.searxng.org) instance and
save pages locally as searchable markdown:

- **`web_search`** — queries `{baseUrl}/search?format=json` and returns a
  numbered list of results (title, URL, snippet). The instance must have the
  JSON format enabled in `settings.yml` (`search: formats: [html, json]`).
- **`fetch_url`** — fetches an http(s) page, converts HTML to markdown with a
  built-in dependency-free extractor (plain text is saved as-is; PDFs and
  other binary types are politely refused), and writes it to `saveDir` with
  `url` / `title` / `fetched` frontmatter. Re-fetching a URL refreshes its
  file. `saveDir` can be a function of the run config for per-thread dirs.

Pair the family with `fileExplorationTools` jailed to the same directory so
the agent can search what it saved:

```ts
import { webResearchTools, fileExplorationTools } from "@harpua/agent-tools";
import { ToolNode } from "@langchain/langgraph/prebuilt";

const sources = "./sources";
const toolNode = new ToolNode([
  ...webResearchTools({ baseUrl: "http://localhost:8080", saveDir: sources }),
  ...fileExplorationTools({ root: sources }),
]);
```

Both tools return every failure (network, HTTP status, content type, size
cap, filesystem) as a friendly string — they never throw mid-graph. The
model chooses the URLs: publicly-deployed apps should gate `fetch_url`
(e.g. `requireApproval()` from `@harpua/langgraph`) or front it with an
allowlist.
```

Adjust placement/heading depth to match the actual README structure you observe — content above is the requirement, formatting follows the file.

- [ ] **Step 2: Add the changeset**

Create `.changeset/web-research-tools.md` (repo root):

```markdown
---
"@harpua/agent-tools": patch
---

Add the web-research tool family: `web_search` (SearXNG-backed search) and `fetch_url` (fetch a page, convert HTML to markdown with a dependency-free extractor, save with frontmatter), plus a `webResearchTools()` bundle. Pair with `fileExplorationTools` over the same directory to search saved pages.
```

(Patch, not minor: 0.x semantics — features are patches, per `.claude/skills/release/SKILL.md`.)

- [ ] **Step 3: ROOT-protocol verification**

From the repo root `/Users/leathcooper/ai-workspace/harpua`:

Run: `pnpm turbo build lint test --force`
Expected: every package builds, lints, and tests green — not just agent-tools. Per-package `--filter` runs are NOT sufficient here; this is the repo's stated bar before claiming done.

- [ ] **Step 4: Confirm zero new runtime dependencies**

Run: `git diff main -- packages/agent-tools/package.json`
Expected: NO output (the package manifest is untouched — no new deps, no script changes).

- [ ] **Step 5: Commit**

```bash
git add packages/agent-tools/README.md .changeset/web-research-tools.md
git commit -m "docs(agent-tools): document the web-research family; add changeset"
```

- [ ] **Step 6: Push the branch (PR is the merge path)**

```bash
git push -u origin feat/web-research-tools
gh pr create --title "feat(agent-tools): web-research tool family (web_search + fetch_url)" --body "$(cat <<'EOF'
Adds the web-research tool family to @harpua/agent-tools per
docs/superpowers/specs/2026-07-08-web-research-tools-design.md:

- web_search — SearXNG JSON API, numbered results, friendly-string failures
- fetch_url — fetch → built-in HTML→markdown → save with frontmatter;
  content-type gating (HTML/plain only, PDFs refused), size caps,
  saveDir-as-resolver for per-thread dirs
- webResearchTools() bundle mirroring fileExplorationTools
- Zero new runtime dependencies; fully offline deterministic tests,
  including an integration test that greps a fetched page via
  fileExplorationTools
- Changeset: patch bump

Verified with the ROOT protocol: pnpm turbo build lint test --force.
EOF
)"
```

The maintainer (repo owner) merges the PR; the release train handles npm.
