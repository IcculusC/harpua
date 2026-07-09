# Knowledge Tool Family Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `knowledge` family to `@harpua/agent-tools` — a `search_knowledge` tool doing chunk/embed/index/cosine retrieval over a directory of markdown (the corpus `fetch_url`/`fetch_pdf` build), with a deterministic keyless mock embedder and LangChain-native pluggability.

**Architecture:** Mirrors the existing families: one artifact per file under `src/knowledge/`, strict zod options, `factory(options) → tool()`, never-throws tool contract. Chunker and mock embedder are pure code; a sidecar index at `<root>/.knowledge/index.json` caches chunk vectors with per-file content hashes and an embedder fingerprint; every search call lazily re-syncs the index, then brute-force cosine (`ml-distance`) ranks chunks.

**Tech Stack:** TypeScript (CommonJS), zod, `@langchain/core` `EmbeddingsInterface` (peer), `ml-distance` (NEW — the package's first runtime dependency), node:crypto/node:fs, Jest + ts-jest.

Spec: `docs/superpowers/specs/2026-07-09-knowledge-tools-design.md`.

## Global Constraints

- Repo worktree: `/Users/leathcooper/ai-workspace/harpua-worktrees/feat-knowledge-tools`, branch `feat/knowledge-tools`. All paths relative to `packages/agent-tools/` unless stated. Commit here; never touch the main checkout at `~/ai-workspace/harpua`.
- **Exactly one new runtime dependency: `ml-distance` (^4.0.1).** It is the package's first; nothing else gets added. `@langchain/core` stays a peer (type-only + interface imports).
- **Zod for all runtime validation**; function/object-valued options via `z.custom<T>(...)`; all option schemas `.strict()`.
- **The tool never throws** — every failure returns a string starting `search_knowledge:`. Corrupt/unreadable index → rebuilt silently (the sidecar is a cache; markdown is the source of truth). Index write failure → still answer from memory, append a note.
- **No bare `new Date()`/`Math.random()` in logic under test** (nothing here needs time or randomness; the mock embedder must be fully deterministic).
- Exact defaults from the spec: `topK` 5 (ceiling 20), `maxChunkChars` 1200, `minScore` optional with NO default (cosine can be negative; 0 is not a safe "off").
- Index file: `<root>/.knowledge/index.json`, schema `{ version: 1, fingerprint, files: { [relPath]: { hash, chunks } } }`. Only top-level `*.md` files of the corpus dir are indexed; `.knowledge/` itself is never scanned.
- Embedder fingerprint = `<constructor name>:<vector dimension>`; any mismatch (name or dimension) forces a full rebuild — vector spaces must never mix.
- Guard guidance (`packages/langgraph/skills/graph-operations/references/tool.md`, "model-supplied resources" section from #15) binds this tool: the model supplies ONLY a query string; `root` resolves from the run config or factory options, never from model input; only `*.md` under the resolved root is ever read.
- Per-task verification: focused jest + `pnpm --filter @harpua/agent-tools build lint test`. Final task: ROOT protocol `pnpm turbo build lint test --force` from the worktree root.
- Changeset REQUIRED: **patch**, and its text must flag the new `ml-distance` runtime dependency prominently.
- Conventional commits, no AI attribution trailers.

---

### Task 1: `MockEmbeddings`

**Files:**
- Create: `packages/agent-tools/src/knowledge/mock-embeddings.ts`
- Test: `packages/agent-tools/src/__tests__/mock-embeddings.spec.ts`

**Interfaces:**
- Consumes: `EmbeddingsInterface` (type) from `@langchain/core/embeddings`.
- Produces: `class MockEmbeddings implements EmbeddingsInterface` with `embedDocuments(documents: string[]): Promise<number[][]>`, `embedQuery(document: string): Promise<number[]>`, and exported constant `MOCK_EMBEDDING_DIMENSION = 256`.

- [ ] **Step 1: Write the failing test**

Create `packages/agent-tools/src/__tests__/mock-embeddings.spec.ts`:

```ts
import {
  MockEmbeddings,
  MOCK_EMBEDDING_DIMENSION,
} from "../knowledge/mock-embeddings";

function cosine(a: number[], b: number[]): number {
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += a[i]! * b[i]!;
  return dot; // vectors are unit-normalized, so dot product IS cosine
}

describe("MockEmbeddings", () => {
  const embeddings = new MockEmbeddings();

  it("is deterministic and produces unit vectors of the documented dimension", async () => {
    const [a] = await embeddings.embedDocuments(["dropout voltage 1.5 V"]);
    const b = await embeddings.embedQuery("dropout voltage 1.5 V");
    expect(a).toEqual(b);
    expect(a).toHaveLength(MOCK_EMBEDDING_DIMENSION);
    const norm = Math.sqrt(a!.reduce((s, v) => s + v * v, 0));
    expect(norm).toBeCloseTo(1, 10);
  });

  it("scores word-overlapping texts higher than disjoint ones", async () => {
    const query = await embeddings.embedQuery("LM317 dropout voltage");
    const [related, unrelated] = await embeddings.embedDocuments([
      "the LM317 has a dropout voltage of 1.5 V",
      "sourdough starter needs regular feeding",
    ]);
    expect(cosine(query, related!)).toBeGreaterThan(cosine(query, unrelated!));
  });

  it("is case-insensitive and returns a zero vector for empty text without NaN", async () => {
    const upper = await embeddings.embedQuery("DROPOUT VOLTAGE");
    const lower = await embeddings.embedQuery("dropout voltage");
    expect(upper).toEqual(lower);
    const empty = await embeddings.embedQuery("");
    expect(empty).toHaveLength(MOCK_EMBEDDING_DIMENSION);
    expect(empty.every((v) => v === 0)).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @harpua/agent-tools exec jest mock-embeddings`
Expected: FAIL — cannot find module.

- [ ] **Step 3: Write the implementation**

Create `packages/agent-tools/src/knowledge/mock-embeddings.ts`:

```ts
import type { EmbeddingsInterface } from "@langchain/core/embeddings";

/** Dimension of the mock's hashed bag-of-words vectors. */
export const MOCK_EMBEDDING_DIMENSION = 256;

/**
 * FNV-1a 32-bit hash. Deliberately parallels the private helper in
 * `../web-research/save-page.ts` (8 lines of a standard algorithm) rather
 * than coupling the families through a shared module.
 */
function fnv1a(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash;
}

/**
 * The MockChatModel of embeddings: a deterministic, offline, dependency-free
 * stand-in implementing LangChain's `EmbeddingsInterface`. Lowercased word
 * tokens are feature-hashed into a fixed-dimension vector, L2-normalized.
 * Word overlap → higher cosine. This is LEXICAL similarity for keyless boot
 * and tests — not a semantic embedder; pass a real embeddings instance
 * (e.g. OpenRouter's endpoint via `OpenAIEmbeddings`) for real semantics.
 */
export class MockEmbeddings implements EmbeddingsInterface {
  async embedDocuments(documents: string[]): Promise<number[][]> {
    return documents.map((document) => this.vectorFor(document));
  }

  async embedQuery(document: string): Promise<number[]> {
    return this.vectorFor(document);
  }

  private vectorFor(text: string): number[] {
    const vector = new Array<number>(MOCK_EMBEDDING_DIMENSION).fill(0);
    const words = text.toLowerCase().match(/[a-z0-9]+/g) ?? [];
    for (const word of words) {
      vector[fnv1a(word) % MOCK_EMBEDDING_DIMENSION] += 1;
    }
    const norm = Math.sqrt(vector.reduce((sum, v) => sum + v * v, 0));
    return norm === 0 ? vector : vector.map((v) => v / norm);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @harpua/agent-tools exec jest mock-embeddings`
Expected: PASS (3 tests).

- [ ] **Step 5: Package build + lint + tests, then commit**

Run: `pnpm --filter @harpua/agent-tools build lint test`
Expected: all green.

```bash
git add packages/agent-tools/src/knowledge/ packages/agent-tools/src/__tests__/mock-embeddings.spec.ts
git commit -m "feat(agent-tools): deterministic MockEmbeddings for keyless retrieval"
```

---

### Task 2: Markdown chunker

**Files:**
- Create: `packages/agent-tools/src/knowledge/chunk-markdown.ts`
- Test: `packages/agent-tools/src/__tests__/chunk-markdown.spec.ts`

**Interfaces:**
- Consumes: nothing (pure function).
- Produces: `chunkMarkdown(markdown: string, options: { maxChunkChars: number }): MarkdownChunk[]` and `interface MarkdownChunk { text: string; startLine: number; endLine: number; headingTrail: string[] }` (line numbers 1-based, inclusive, true to the ORIGINAL file including frontmatter lines).

- [ ] **Step 1: Write the failing test**

Create `packages/agent-tools/src/__tests__/chunk-markdown.spec.ts`:

```ts
import { chunkMarkdown } from "../knowledge/chunk-markdown";

const OPTS = { maxChunkChars: 1200 };

const PAGE = [
  "---", // 1
  "url: https://ti.com/lm317", // 2
  "title: LM317", // 3
  "fetched: 2026-07-09", // 4
  "---", // 5
  "", // 6
  "# LM317", // 7
  "", // 8
  "An adjustable regulator.", // 9
  "", // 10
  "## Electrical Characteristics", // 11
  "", // 12
  "- Dropout: 1.5 V @ 1 A", // 13
  "- Package: TO-220", // 14
  "", // 15
  "### Thermal", // 16
  "", // 17
  "Junction to ambient 50 C/W.", // 18
].join("\n");

describe("chunkMarkdown", () => {
  it("splits at headings with true line spans and heading trails", () => {
    const chunks = chunkMarkdown(PAGE, OPTS);
    expect(chunks).toHaveLength(3);

    expect(chunks[0]).toMatchObject({
      startLine: 7,
      endLine: 10,
      headingTrail: ["LM317"],
    });
    expect(chunks[0]!.text).toContain("An adjustable regulator.");

    expect(chunks[1]).toMatchObject({
      startLine: 11,
      endLine: 15,
      headingTrail: ["LM317", "Electrical Characteristics"],
    });
    expect(chunks[1]!.text).toContain("Dropout: 1.5 V @ 1 A");

    expect(chunks[2]).toMatchObject({
      startLine: 16,
      endLine: 18,
      headingTrail: ["LM317", "Electrical Characteristics", "Thermal"],
    });
  });

  it("excludes frontmatter from chunk text but keeps line numbers true", () => {
    const chunks = chunkMarkdown(PAGE, OPTS);
    expect(chunks[0]!.text).not.toContain("fetched:");
    expect(chunks[0]!.startLine).toBe(7); // not 2
  });

  it("chunks content before any heading, with an empty trail", () => {
    const chunks = chunkMarkdown("plain text\nwith no headings", OPTS);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toMatchObject({ startLine: 1, endLine: 2, headingTrail: [] });
  });

  it("splits oversized sections at paragraph boundaries", () => {
    const paragraph = "word ".repeat(100).trim(); // ~500 chars
    const md = ["## Big", "", paragraph, "", paragraph, "", paragraph].join("\n");
    const chunks = chunkMarkdown(md, { maxChunkChars: 700 });
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.headingTrail).toEqual(["Big"]);
      expect(chunk.text.length).toBeLessThanOrEqual(700 + paragraph.length);
    }
    // spans must tile without overlap
    for (let i = 1; i < chunks.length; i++) {
      expect(chunks[i]!.startLine).toBeGreaterThan(chunks[i - 1]!.endLine);
    }
  });

  it("keeps a single paragraph over the cap as one chunk (never splits mid-paragraph)", () => {
    const huge = "word ".repeat(500).trim();
    const chunks = chunkMarkdown(`## Big\n\n${huge}`, { maxChunkChars: 100 });
    expect(chunks.some((c) => c.text.includes(huge))).toBe(true);
  });

  it("drops whitespace-only sections and handles empty input", () => {
    expect(chunkMarkdown("", OPTS)).toEqual([]);
    expect(chunkMarkdown("## Empty\n\n\n## Also Empty", OPTS)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @harpua/agent-tools exec jest chunk-markdown`
Expected: FAIL — cannot find module.

- [ ] **Step 3: Write the implementation**

Create `packages/agent-tools/src/knowledge/chunk-markdown.ts`:

```ts
/** One retrievable unit of a markdown document. Line numbers are 1-based,
 * inclusive, and true to the original file (frontmatter lines count). */
export interface MarkdownChunk {
  text: string;
  startLine: number;
  endLine: number;
  /** Headings above and including this chunk's section, outermost first. */
  headingTrail: string[];
}

const HEADING = /^(#{1,3})\s+(.+?)\s*$/;

interface Section {
  headingTrail: string[];
  /** [lineNumber, text] pairs for every line in the section. */
  lines: Array<[number, string]>;
}

/**
 * Heading-aware chunking for the knowledge index. Splits at h1–h3
 * boundaries; sections longer than `maxChunkChars` split further at blank
 * lines (never mid-paragraph). YAML frontmatter is excluded from text but
 * line numbering stays true so results point at the real file.
 */
export function chunkMarkdown(
  markdown: string,
  options: { maxChunkChars: number },
): MarkdownChunk[] {
  const lines = markdown.split("\n");

  // Skip frontmatter: a leading "---" line closed by the next "---" line.
  let start = 0;
  if (lines[0] === "---") {
    const close = lines.indexOf("---", 1);
    if (close !== -1) start = close + 1;
  }

  // Pass 1: group lines into heading-bounded sections with trails.
  const sections: Section[] = [];
  const trail: Array<string | undefined> = []; // index = heading level - 1
  let current: Section = { headingTrail: [], lines: [] };

  const flush = (): void => {
    if (current.lines.length > 0) sections.push(current);
  };

  for (let i = start; i < lines.length; i++) {
    const line = lines[i]!;
    const heading = HEADING.exec(line);
    if (heading) {
      flush();
      const level = heading[1]!.length;
      trail[level - 1] = heading[2]!;
      trail.length = level; // deeper headings reset
      current = {
        headingTrail: trail.filter((h): h is string => h !== undefined),
        lines: [[i + 1, line]],
      };
    } else {
      current.lines.push([i + 1, line]);
    }
  }
  flush();

  // Pass 2: split oversized sections at blank-line (paragraph) boundaries.
  // A section's own heading line is NOT part of the chunk text (the trail
  // already carries it) but the first chunk's span still starts at the
  // heading line so read_lines shows it. Heading-only sections vanish.
  const chunks: MarkdownChunk[] = [];
  for (const section of sections) {
    const startsWithHeading =
      section.lines.length > 0 && HEADING.test(section.lines[0]![1]);
    const bodyLines = startsWithHeading ? section.lines.slice(1) : section.lines;
    if (bodyLines.length === 0) continue;

    const groups = splitByParagraphs(bodyLines, options.maxChunkChars);
    for (let g = 0; g < groups.length; g++) {
      const group = groups[g]!;
      const text = group.map(([, line]) => line).join("\n").trim();
      if (text.length === 0) continue;
      chunks.push({
        text,
        startLine:
          g === 0 && startsWithHeading ? section.lines[0]![0] : group[0]![0],
        endLine: group[group.length - 1]![0],
        headingTrail: section.headingTrail,
      });
    }
  }
  return chunks;
}

/** Greedily pack paragraphs (blank-line separated runs) up to the cap. */
function splitByParagraphs(
  lines: Array<[number, string]>,
  maxChars: number,
): Array<Array<[number, string]>> {
  const totalChars = lines.reduce((sum, [, l]) => sum + l.length + 1, 0);
  if (totalChars <= maxChars) return [lines];

  // Break into paragraphs (blank lines attach to the preceding paragraph).
  const paragraphs: Array<Array<[number, string]>> = [];
  let paragraph: Array<[number, string]> = [];
  for (const entry of lines) {
    paragraph.push(entry);
    if (entry[1].trim() === "" && paragraph.some(([, l]) => l.trim() !== "")) {
      paragraphs.push(paragraph);
      paragraph = [];
    }
  }
  if (paragraph.length > 0) paragraphs.push(paragraph);

  const groups: Array<Array<[number, string]>> = [];
  let group: Array<[number, string]> = [];
  let groupChars = 0;
  for (const p of paragraphs) {
    const pChars = p.reduce((sum, [, l]) => sum + l.length + 1, 0);
    if (group.length > 0 && groupChars + pChars > maxChars) {
      groups.push(group);
      group = [];
      groupChars = 0;
    }
    group.push(...p); // a single over-cap paragraph stays whole
    groupChars += pChars;
  }
  if (group.length > 0) groups.push(group);
  return groups;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @harpua/agent-tools exec jest chunk-markdown`
Expected: PASS (6 tests). If line-span assertions fail, print the actual chunks — off-by-ones concentrate in the frontmatter skip and the heading-line inclusion.

- [ ] **Step 5: Package build + lint + tests, then commit**

Run: `pnpm --filter @harpua/agent-tools build lint test`

```bash
git add packages/agent-tools/src/knowledge/chunk-markdown.ts packages/agent-tools/src/__tests__/chunk-markdown.spec.ts
git commit -m "feat(agent-tools): heading-aware markdown chunker with true line spans"
```

---

### Task 3: Knowledge options

**Files:**
- Create: `packages/agent-tools/src/knowledge/options.ts`
- Test: `packages/agent-tools/src/__tests__/knowledge-options.spec.ts`

**Interfaces:**
- Consumes: `MockEmbeddings` (Task 1); `EmbeddingsInterface`, `RunnableConfig` types from `@langchain/core`.
- Produces: `searchKnowledgeToolOptionsSchema`, `resolveSearchKnowledgeOptions(options)`, types `SearchKnowledgeToolOptions` (z.input) / `ResolvedSearchKnowledgeToolOptions` (z.output), `type KnowledgeRootResolver = (config?: RunnableConfig) => string`, constants `DEFAULT_TOP_K = 5`, `TOP_K_CEILING = 20`, `DEFAULT_MAX_CHUNK_CHARS = 1200`.

- [ ] **Step 1: Write the failing test**

Create `packages/agent-tools/src/__tests__/knowledge-options.spec.ts`:

```ts
import {
  resolveSearchKnowledgeOptions,
  DEFAULT_TOP_K,
  DEFAULT_MAX_CHUNK_CHARS,
} from "../knowledge/options";
import { MockEmbeddings } from "../knowledge/mock-embeddings";

describe("search_knowledge options", () => {
  it("applies defaults with only root given, including a MockEmbeddings instance", () => {
    const opts = resolveSearchKnowledgeOptions({ root: "/tmp/corpus" });
    expect(opts.topK).toBe(DEFAULT_TOP_K);
    expect(opts.maxChunkChars).toBe(DEFAULT_MAX_CHUNK_CHARS);
    expect(opts.minScore).toBeUndefined();
    expect(opts.embeddings).toBeInstanceOf(MockEmbeddings);
  });

  it("accepts root as a function and passes a custom embeddings object through", () => {
    const resolver = () => "/tmp/other";
    const custom = {
      embedDocuments: async (docs: string[]) => docs.map(() => [1, 0]),
      embedQuery: async () => [1, 0],
    };
    const opts = resolveSearchKnowledgeOptions({ root: resolver, embeddings: custom });
    expect(opts.root).toBe(resolver);
    expect(opts.embeddings).toBe(custom);
  });

  it("rejects topK over the ceiling, unknown keys, and non-embeddings objects", () => {
    expect(() =>
      resolveSearchKnowledgeOptions({ root: "/x", topK: 21 }),
    ).toThrow();
    expect(() =>
      resolveSearchKnowledgeOptions({ root: "/x", nope: 1 } as never),
    ).toThrow();
    expect(() =>
      resolveSearchKnowledgeOptions({ root: "/x", embeddings: {} } as never),
    ).toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @harpua/agent-tools exec jest knowledge-options`
Expected: FAIL — cannot find module `../knowledge/options`.

- [ ] **Step 3: Write the implementation**

Create `packages/agent-tools/src/knowledge/options.ts`:

```ts
import type { EmbeddingsInterface } from "@langchain/core/embeddings";
import type { RunnableConfig } from "@langchain/core/runnables";
import { z } from "zod";

import { MockEmbeddings } from "./mock-embeddings";

/** Sane default number of chunks a search returns. */
export const DEFAULT_TOP_K = 5;
/** Hard ceiling on returned chunks regardless of configuration. */
export const TOP_K_CEILING = 20;
/** Sane default size cap that oversized sections are split down to. */
export const DEFAULT_MAX_CHUNK_CHARS = 1200;

/** Resolves the corpus directory at call time (receives the run config). */
export type KnowledgeRootResolver = (config?: RunnableConfig) => string;

const embeddingsSchema = z.custom<EmbeddingsInterface>(
  (v) =>
    typeof v === "object" &&
    v !== null &&
    typeof (v as EmbeddingsInterface).embedDocuments === "function" &&
    typeof (v as EmbeddingsInterface).embedQuery === "function",
  "embeddings must implement embedDocuments and embedQuery",
);

const rootResolverSchema = z.custom<KnowledgeRootResolver>(
  (v) => typeof v === "function",
  "root must be a string or a function",
);

/**
 * Options for {@link searchKnowledgeTool}. `root` is the corpus directory
 * (string or per-call resolver, same pattern as fetch_url's saveDir);
 * `embeddings` is any LangChain embeddings instance — the deterministic
 * {@link MockEmbeddings} by default so the tool boots keyless. Unknown keys
 * are rejected.
 */
export const searchKnowledgeToolOptionsSchema = z
  .object({
    /** Corpus directory of markdown files (string or per-call resolver). */
    root: z.union([z.string().min(1), rootResolverSchema]),
    /** LangChain embeddings instance; defaults to the lexical mock. */
    embeddings: embeddingsSchema.default(() => new MockEmbeddings()),
    /** Chunks returned per query (hard-capped at {@link TOP_K_CEILING}). */
    topK: z.number().int().positive().max(TOP_K_CEILING).default(DEFAULT_TOP_K),
    /** Oversized sections are split down to roughly this many characters. */
    maxChunkChars: z.number().int().positive().default(DEFAULT_MAX_CHUNK_CHARS),
    /**
     * When set, chunks scoring below this are omitted. No default on
     * purpose: cosine scores from real embedders can be negative, so 0 is
     * not a safe "off" value.
     */
    minScore: z.number().optional(),
  })
  .strict();

/** Caller-facing options: `root` required, everything else defaulted. */
export type SearchKnowledgeToolOptions = z.input<typeof searchKnowledgeToolOptionsSchema>;
/** Fully-resolved options with all defaults applied. */
export type ResolvedSearchKnowledgeToolOptions = z.output<typeof searchKnowledgeToolOptionsSchema>;

/** Parse + default search_knowledge options, throwing on an invalid shape. */
export function resolveSearchKnowledgeOptions(
  options: SearchKnowledgeToolOptions,
): ResolvedSearchKnowledgeToolOptions {
  return searchKnowledgeToolOptionsSchema.parse(options);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @harpua/agent-tools exec jest knowledge-options`
Expected: PASS (3 tests).

- [ ] **Step 5: Package build + lint + tests, then commit**

Run: `pnpm --filter @harpua/agent-tools build lint test`

```bash
git add packages/agent-tools/src/knowledge/options.ts packages/agent-tools/src/__tests__/knowledge-options.spec.ts
git commit -m "feat(agent-tools): search_knowledge option schema"
```

---

### Task 4: Sidecar index with lazy freshness

**Files:**
- Create: `packages/agent-tools/src/knowledge/knowledge-index.ts`
- Test: `packages/agent-tools/src/__tests__/knowledge-index.spec.ts`

**Interfaces:**
- Consumes: `chunkMarkdown`/`MarkdownChunk` (Task 2); `EmbeddingsInterface` type; `makeTmpDir`/`removeTmpDir`/`writeFile` from `./tmp-tree` (existing helpers).
- Produces (Task 5 relies on these exactly):
  - `interface IndexedChunk extends MarkdownChunk { vector: number[] }`
  - `interface KnowledgeIndex { version: 1; fingerprint: string; files: Record<string, { hash: string; chunks: IndexedChunk[] }> }`
  - `interface SyncResult { index: KnowledgeIndex; persistError?: string }`
  - `syncIndex(args: { root: string; embeddings: EmbeddingsInterface; maxChunkChars: number; expectedDimension?: number }): Promise<SyncResult>` — may reject only on embedder failure (caller turns that into a friendly string); filesystem write failure is captured in `persistError`, never thrown.
  - `embeddingTextFor(chunk: MarkdownChunk): string` — `[...headingTrail, text].join("\n")`, exported so search formatting/tests share it.

- [ ] **Step 1: Write the failing test**

Create `packages/agent-tools/src/__tests__/knowledge-index.spec.ts`:

```ts
import fs from "node:fs";
import path from "node:path";

import { syncIndex } from "../knowledge/knowledge-index";
import { MockEmbeddings } from "../knowledge/mock-embeddings";
import { makeTmpDir, removeTmpDir, writeFile } from "./tmp-tree";

const embeddings = new MockEmbeddings();
const ARGS = { embeddings, maxChunkChars: 1200 };

describe("syncIndex", () => {
  let root: string;
  beforeEach(() => (root = makeTmpDir()));
  afterEach(() => removeTmpDir(root));

  const indexPath = () => path.join(root, ".knowledge", "index.json");

  it("builds the index from markdown files and persists it hidden", async () => {
    writeFile(root, "lm317.md", "## Specs\n\nDropout 1.5 V.");
    const { index, persistError } = await syncIndex({ root, ...ARGS });
    expect(persistError).toBeUndefined();
    expect(index.files["lm317.md"]!.chunks).toHaveLength(1);
    expect(index.files["lm317.md"]!.chunks[0]!.vector.length).toBeGreaterThan(0);
    expect(fs.existsSync(indexPath())).toBe(true);
  });

  it("re-embeds only changed files and drops deleted ones", async () => {
    writeFile(root, "a.md", "## A\n\nalpha");
    writeFile(root, "b.md", "## B\n\nbeta");
    const first = await syncIndex({ root, ...ARGS });
    const untouchedVector = first.index.files["b.md"]!.chunks[0]!.vector;

    const calls: string[][] = [];
    const spying = {
      embedDocuments: async (docs: string[]) => {
        calls.push(docs);
        return embeddings.embedDocuments(docs);
      },
      embedQuery: (q: string) => embeddings.embedQuery(q),
    };

    writeFile(root, "a.md", "## A\n\nalpha CHANGED");
    fs.rmSync(path.join(root, "b.md"));
    const second = await syncIndex({ root, embeddings: spying, maxChunkChars: 1200 });

    expect(second.index.files["b.md"]).toBeUndefined();
    expect(second.index.files["a.md"]!.chunks[0]!.text).toContain("CHANGED");
    // only a.md was re-embedded
    expect(calls.flat().join("\n")).toContain("CHANGED");
    expect(calls.flat().join("\n")).not.toContain("beta");
    void untouchedVector;
  });

  it("ignores non-md files, subdirectories, and the .knowledge dir itself", async () => {
    writeFile(root, "page.md", "## P\n\ncontent");
    writeFile(root, "notes.txt", "not markdown");
    writeFile(root, "sub/nested.md", "## N\n\nnested");
    await syncIndex({ root, ...ARGS });
    const again = await syncIndex({ root, ...ARGS });
    expect(Object.keys(again.index.files)).toEqual(["page.md"]);
  });

  it("rebuilds fully when the embedder fingerprint changes", async () => {
    writeFile(root, "a.md", "## A\n\nalpha");
    await syncIndex({ root, ...ARGS });
    const twoDim = {
      embedDocuments: async (docs: string[]) => docs.map(() => [1, 0]),
      embedQuery: async () => [1, 0],
    };
    const rebuilt = await syncIndex({
      root,
      embeddings: twoDim,
      maxChunkChars: 1200,
      expectedDimension: 2,
    });
    expect(rebuilt.index.files["a.md"]!.chunks[0]!.vector).toEqual([1, 0]);
  });

  it("treats a corrupt index file as absent and rebuilds without error", async () => {
    writeFile(root, "a.md", "## A\n\nalpha");
    await syncIndex({ root, ...ARGS });
    fs.writeFileSync(indexPath(), "{not json!!");
    const rebuilt = await syncIndex({ root, ...ARGS });
    expect(rebuilt.index.files["a.md"]!.chunks).toHaveLength(1);
  });

  it("returns an empty index for an empty or missing corpus dir", async () => {
    const { index } = await syncIndex({ root, ...ARGS });
    expect(index.files).toEqual({});
    const missing = path.join(root, "nope");
    const result = await syncIndex({ root: missing, ...ARGS });
    expect(result.index.files).toEqual({});
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @harpua/agent-tools exec jest knowledge-index`
Expected: FAIL — cannot find module.

- [ ] **Step 3: Write the implementation**

Create `packages/agent-tools/src/knowledge/knowledge-index.ts`:

```ts
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import type { EmbeddingsInterface } from "@langchain/core/embeddings";

import { chunkMarkdown, type MarkdownChunk } from "./chunk-markdown";

export const INDEX_VERSION = 1 as const;

export interface IndexedChunk extends MarkdownChunk {
  vector: number[];
}

export interface KnowledgeIndex {
  version: typeof INDEX_VERSION;
  /** `<embedder constructor name>:<vector dimension>` — mismatch → rebuild. */
  fingerprint: string;
  files: Record<string, { hash: string; chunks: IndexedChunk[] }>;
}

export interface SyncResult {
  index: KnowledgeIndex;
  /** Set when the index could not be written back; the in-memory index is still valid. */
  persistError?: string;
}

/** The text a chunk is embedded as: heading context + body. */
export function embeddingTextFor(chunk: MarkdownChunk): string {
  return [...chunk.headingTrail, chunk.text].join("\n");
}

function sha256(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

function fingerprintOf(embeddings: EmbeddingsInterface, dimension: number): string {
  const name = (embeddings as object).constructor?.name ?? "unknown";
  return `${name}:${dimension}`;
}

function loadIndex(indexPath: string): KnowledgeIndex | null {
  try {
    const parsed = JSON.parse(fs.readFileSync(indexPath, "utf8")) as KnowledgeIndex;
    return parsed.version === INDEX_VERSION && typeof parsed.files === "object"
      ? parsed
      : null;
  } catch {
    return null; // absent or corrupt — the sidecar is only a cache
  }
}

function listMarkdownFiles(root: string): string[] {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return []; // missing corpus dir → empty corpus
  }
  return entries
    .filter((e) => e.isFile() && e.name.endsWith(".md"))
    .map((e) => e.name)
    .sort();
}

/**
 * Bring the sidecar index at `<root>/.knowledge/index.json` up to date:
 * re-chunk + re-embed only new/changed files, drop deleted ones, rebuild
 * everything when the embedder fingerprint (constructor name + vector
 * dimension) differs — vector spaces must never mix. Rejects only if the
 * embedder itself fails; a filesystem write failure is reported in
 * `persistError` and the in-memory index is still returned.
 */
export async function syncIndex(args: {
  root: string;
  embeddings: EmbeddingsInterface;
  maxChunkChars: number;
  /** Known query-vector dimension; forces a rebuild when stored vectors differ. */
  expectedDimension?: number;
}): Promise<SyncResult> {
  const indexPath = path.join(args.root, ".knowledge", "index.json");
  let existing = loadIndex(indexPath);

  // Fingerprint pre-checks against the existing index.
  if (existing) {
    const [name] = existing.fingerprint.split(":");
    const currentName = (args.embeddings as object).constructor?.name ?? "unknown";
    const storedDimension = Number(existing.fingerprint.split(":")[1]);
    const dimensionMismatch =
      args.expectedDimension !== undefined && storedDimension !== args.expectedDimension;
    if (name !== currentName || dimensionMismatch) existing = null;
  }

  const files = listMarkdownFiles(args.root);
  const next: KnowledgeIndex = {
    version: INDEX_VERSION,
    fingerprint: existing?.fingerprint ?? "",
    files: {},
  };

  let dimension = existing ? Number(existing.fingerprint.split(":")[1]) : undefined;

  for (const name of files) {
    const content = fs.readFileSync(path.join(args.root, name), "utf8");
    const hash = sha256(content);
    const previous = existing?.files[name];
    if (previous && previous.hash === hash) {
      next.files[name] = previous;
      continue;
    }
    const chunks = chunkMarkdown(content, { maxChunkChars: args.maxChunkChars });
    if (chunks.length === 0) {
      next.files[name] = { hash, chunks: [] };
      continue;
    }
    const vectors = await args.embeddings.embedDocuments(chunks.map(embeddingTextFor));
    next.files[name] = {
      hash,
      chunks: chunks.map((chunk, i) => ({ ...chunk, vector: vectors[i] ?? [] })),
    };
    dimension = vectors[0]?.length ?? dimension;
  }

  next.fingerprint = fingerprintOf(args.embeddings, dimension ?? args.expectedDimension ?? 0);

  let persistError: string | undefined;
  try {
    fs.mkdirSync(path.dirname(indexPath), { recursive: true });
    fs.writeFileSync(indexPath, JSON.stringify(next));
  } catch (err) {
    persistError = err instanceof Error ? err.message : String(err);
  }
  return { index: next, persistError };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @harpua/agent-tools exec jest knowledge-index`
Expected: PASS (6 tests).

- [ ] **Step 5: Package build + lint + tests, then commit**

Run: `pnpm --filter @harpua/agent-tools build lint test`

```bash
git add packages/agent-tools/src/knowledge/knowledge-index.ts packages/agent-tools/src/__tests__/knowledge-index.spec.ts
git commit -m "feat(agent-tools): sidecar knowledge index with lazy per-file freshness"
```

---

### Task 5: `search_knowledge` tool (+ the `ml-distance` dependency)

**Files:**
- Modify: `packages/agent-tools/package.json` (gains its first `dependencies` block: `"ml-distance": "^4.0.1"` — the `pnpm add` command below places it correctly)
- Create: `packages/agent-tools/src/knowledge/search-knowledge.ts`
- Test: `packages/agent-tools/src/__tests__/search-knowledge.spec.ts`

**Interfaces:**
- Consumes: `resolveSearchKnowledgeOptions` + types (Task 3), `syncIndex`/`SyncResult` (Task 4), `MockEmbeddings` (Task 1, via options default), `errorMessage` from `../web-research/errors` (existing), `similarity` from `ml-distance`.
- Produces: `searchKnowledgeTool(options: SearchKnowledgeToolOptions): StructuredToolInterface` — tool name `search_knowledge`, input `{ query: string }`.

- [ ] **Step 1: Add the dependency**

Run from the worktree root:
```bash
pnpm --filter @harpua/agent-tools add ml-distance@^4.0.1
```
Verify `packages/agent-tools/package.json` gained exactly one `dependencies` entry and the lockfile updated. This is the package's FIRST runtime dependency — expected and spec'd.

- [ ] **Step 2: Write the failing test**

Create `packages/agent-tools/src/__tests__/search-knowledge.spec.ts`:

```ts
import path from "node:path";

import type { RunnableConfig } from "@langchain/core/runnables";

import { searchKnowledgeTool } from "../knowledge/search-knowledge";
import { makeTmpDir, removeTmpDir, writeFile, runTool } from "./tmp-tree";

describe("search_knowledge", () => {
  let root: string;
  beforeEach(() => (root = makeTmpDir()));
  afterEach(() => removeTmpDir(root));

  const seed = () => {
    writeFile(
      root,
      "lm317.md",
      "# LM317\n\n## Electrical Characteristics\n\nDropout voltage 1.5 V at 1 A load.",
    );
    writeFile(
      root,
      "sourdough.md",
      "# Sourdough\n\n## Feeding\n\nFeed the starter with flour and water daily.",
    );
  };

  it("ranks the relevant chunk first with file:line provenance and heading trail", async () => {
    seed();
    const out = await runTool(searchKnowledgeTool({ root }), {
      query: "dropout voltage of the LM317",
    });
    const firstLine = out.split("\n")[0]!;
    expect(firstLine).toContain("lm317.md:");
    expect(firstLine).toMatch(/score/);
    expect(firstLine).toContain("Electrical Characteristics");
    expect(out).toContain("Dropout voltage 1.5 V");
  });

  it("honors topK", async () => {
    seed();
    const out = await runTool(searchKnowledgeTool({ root, topK: 1 }), {
      query: "dropout voltage",
    });
    expect(out).toContain("lm317.md");
    expect(out).not.toContain("sourdough.md");
  });

  it("honors minScore when set", async () => {
    seed();
    const out = await runTool(searchKnowledgeTool({ root, minScore: 0.99 }), {
      query: "zebra xylophone quantum",
    });
    expect(out).toMatch(/search_knowledge: no chunks scored/i);
  });

  it("explains an empty or missing corpus without throwing", async () => {
    const out = await runTool(searchKnowledgeTool({ root }), { query: "anything" });
    expect(out).toMatch(/nothing indexed yet/i);
    const missing = await runTool(
      searchKnowledgeTool({ root: path.join(root, "nope") }),
      { query: "anything" },
    );
    expect(missing).toMatch(/nothing indexed yet/i);
  });

  it("resolves root from the run config (per-thread corpora)", async () => {
    writeFile(root, "buck-v1/lm317.md", "## Specs\n\nDropout 1.5 V.");
    const tool = searchKnowledgeTool({
      root: (config?: RunnableConfig) =>
        path.join(
          root,
          ((config?.configurable as { thread_id?: string } | undefined)?.thread_id ??
            "default"),
        ),
    });
    const out = (await tool.invoke(
      { query: "dropout" },
      { configurable: { thread_id: "buck-v1" } },
    )) as unknown;
    expect(String((out as { content?: unknown })?.content ?? out)).toContain("lm317.md");
  });

  it("returns embedder failures as friendly strings", async () => {
    seed();
    const failing = {
      embedDocuments: async () => {
        throw new Error("401 from embeddings endpoint");
      },
      embedQuery: async () => {
        throw new Error("401 from embeddings endpoint");
      },
    };
    const out = await runTool(searchKnowledgeTool({ root, embeddings: failing }), {
      query: "anything",
    });
    expect(out).toMatch(/^search_knowledge:/);
    expect(out).toContain("401");
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm --filter @harpua/agent-tools exec jest search-knowledge`
Expected: FAIL — cannot find module.

- [ ] **Step 4: Write the implementation**

Create `packages/agent-tools/src/knowledge/search-knowledge.ts`:

```ts
import { tool } from "@langchain/core/tools";
import type { StructuredToolInterface } from "@langchain/core/tools";
import type { RunnableConfig } from "@langchain/core/runnables";
import { similarity } from "ml-distance";
import { z } from "zod";

import { errorMessage } from "../web-research/errors";
import {
  resolveSearchKnowledgeOptions,
  type SearchKnowledgeToolOptions,
} from "./options";
import { syncIndex } from "./knowledge-index";

const DESCRIPTION =
  "Search everything saved in this project's sources (fetched web pages, " +
  "extracted PDFs, notes) by MEANING, not just keywords. Ask a natural-" +
  "language question; you get the most relevant passages with file and line " +
  "references — quote them, or use read_lines on a reference for full " +
  "context. Prefer this over search_files when you don't know the exact " +
  "wording on the page.";

const searchKnowledgeInputSchema = z.object({
  query: z
    .string()
    .min(1)
    .describe(
      "A natural-language question or topic, e.g. 'what is the dropout voltage at 1 A?'",
    ),
});

/**
 * `search_knowledge` — semantic-ish retrieval over a directory of markdown.
 * Each call lazily syncs the sidecar index (only new/changed files are
 * re-embedded), embeds the query, and returns the top-k cosine matches with
 * file:line provenance. Keyless by default via the lexical MockEmbeddings;
 * pass any LangChain embeddings instance for real semantics. Never throws:
 * empty corpora, embedder failures, and index-write failures all come back
 * as strings. The model supplies only the query — the corpus root comes
 * from options or the run config, never from model input.
 */
export function searchKnowledgeTool(
  options: SearchKnowledgeToolOptions,
): StructuredToolInterface {
  const opts = resolveSearchKnowledgeOptions(options);

  return tool(
    async ({ query }, config?: RunnableConfig) => {
      const root = typeof opts.root === "function" ? opts.root(config) : opts.root;

      let queryVector: number[];
      try {
        queryVector = await opts.embeddings.embedQuery(query);
      } catch (err) {
        return `search_knowledge: the embeddings backend failed (${errorMessage(err)}).`;
      }

      let sync;
      try {
        sync = await syncIndex({
          root,
          embeddings: opts.embeddings,
          maxChunkChars: opts.maxChunkChars,
          expectedDimension: queryVector.length,
        });
      } catch (err) {
        return `search_knowledge: indexing the sources failed (${errorMessage(err)}).`;
      }

      const scored = Object.entries(sync.index.files).flatMap(([file, entry]) =>
        entry.chunks.map((chunk) => ({
          file,
          chunk,
          score: similarity.cosine(queryVector, chunk.vector),
        })),
      );

      if (scored.length === 0) {
        return (
          "search_knowledge: nothing indexed yet — save some pages first " +
          "(fetch_url / fetch_pdf) or add markdown files to the sources directory."
        );
      }

      scored.sort((a, b) => b.score - a.score);
      const hits = scored
        .filter((s) => opts.minScore === undefined || s.score >= opts.minScore)
        .slice(0, opts.topK);

      if (hits.length === 0) {
        return `search_knowledge: no chunks scored at or above minScore=${opts.minScore} for "${query}".`;
      }

      const body = hits
        .map(({ file, chunk, score }, i) => {
          const trail =
            chunk.headingTrail.length > 0 ? ` — ${chunk.headingTrail.join(" > ")}` : "";
          const text = chunk.text
            .split("\n")
            .map((line) => `   ${line}`)
            .join("\n");
          return `${i + 1}. ${file}:${chunk.startLine}-${chunk.endLine} (score ${score.toFixed(2)})${trail}\n${text}`;
        })
        .join("\n");

      return sync.persistError
        ? `${body}\n(note: index cache could not be written: ${sync.persistError})`
        : body;
    },
    {
      name: "search_knowledge",
      description: DESCRIPTION,
      schema: searchKnowledgeInputSchema,
    },
  );
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @harpua/agent-tools exec jest search-knowledge`
Expected: PASS (6 tests). If `similarity.cosine` import fails, check `ml-distance`'s export shape in `node_modules/ml-distance/lib/index.d.ts` and adjust the import to match reality — do not vendor a cosine implementation.

- [ ] **Step 6: Package build + lint + tests, then commit**

Run: `pnpm --filter @harpua/agent-tools build lint test`

```bash
git add packages/agent-tools/package.json pnpm-lock.yaml packages/agent-tools/src/knowledge/search-knowledge.ts packages/agent-tools/src/__tests__/search-knowledge.spec.ts
git commit -m "feat(agent-tools): search_knowledge retrieval tool (adds ml-distance dependency)"
```

---

### Task 6: Public exports + cross-family loop test

**Files:**
- Modify: `packages/agent-tools/src/index.ts` (append a knowledge family block; existing content untouched)
- Test: `packages/agent-tools/src/__tests__/knowledge-loop.spec.ts` (create)

**Interfaces:**
- Consumes: everything from Tasks 1–5; `fetchUrlTool` (existing, post-#13 main — its options include `fetchFn`/`now`/`saveDir`; the SSRF guard is literal-only classification, so public-hostname fixtures with an injected `fetchFn` work offline exactly like `fetch-url.spec.ts` does today).
- Produces: package exports — `searchKnowledgeTool`, `MockEmbeddings`, `chunkMarkdown`, types `SearchKnowledgeToolOptions`, `ResolvedSearchKnowledgeToolOptions`, `KnowledgeRootResolver`, `MarkdownChunk`.

- [ ] **Step 1: Write the failing loop test**

Create `packages/agent-tools/src/__tests__/knowledge-loop.spec.ts`:

```ts
import type { FetchFn, FetchResponseLike } from "../web-research/options";
import { fetchUrlTool } from "../web-research/fetch-url";
import { searchKnowledgeTool } from "../knowledge/search-knowledge";
import { makeTmpDir, removeTmpDir, runTool } from "./tmp-tree";

const FIXED_NOW = () => new Date("2026-07-09T12:00:00Z");

const PAGE =
  "<html><head><title>LM317 Product Page</title></head><body>" +
  "<h1>LM317</h1><h2>Electrical Characteristics</h2>" +
  "<p>Dropout voltage 1.5 V typical at 1 A load current.</p>" +
  "<h2>Ordering</h2><p>Available in TO-220 and SOT-223 packages.</p>" +
  "</body></html>";

const htmlFetch: FetchFn = async (): Promise<FetchResponseLike> => ({
  ok: true,
  status: 200,
  headers: { get: (n: string) => (n.toLowerCase() === "content-type" ? "text/html" : null) },
  text: async () => PAGE,
});

describe("web-research → knowledge loop", () => {
  let dir: string;
  beforeEach(() => (dir = makeTmpDir()));
  afterEach(() => removeTmpDir(dir));

  it("finds content from a fetch_url-saved page with true provenance", async () => {
    await runTool(fetchUrlTool({ saveDir: dir, fetchFn: htmlFetch, now: FIXED_NOW }), {
      url: "https://ti.com/lm317",
    });

    const out = await runTool(searchKnowledgeTool({ root: dir }), {
      query: "what is the dropout voltage at 1 A?",
    });

    expect(out).toContain("Dropout voltage 1.5 V typical");
    expect(out).toMatch(/lm317-product-page-[0-9a-f]{8}\.md:\d+-\d+/);
    expect(out).toContain("Electrical Characteristics");
  });
});
```

- [ ] **Step 2: Run to verify current state**

Run: `pnpm --filter @harpua/agent-tools exec jest knowledge-loop`
Expected: PASS already (both tools exist as of Task 5) — this test is new coverage, not TDD of new code; what must NOT happen is any modification to make it pass. If it fails, debug the interaction (most likely the chunker vs the extractor's exact output shape) and fix the knowledge-family code, never the assertions.

- [ ] **Step 3: Append the export block**

Add at the end of `packages/agent-tools/src/index.ts`:

```ts
// Knowledge family: search_knowledge — chunk/embed/index/cosine retrieval
// over a directory of markdown (the corpus fetch_url/fetch_pdf build).
// Keyless by default via MockEmbeddings; pass any LangChain embeddings
// instance for real semantics.
export { searchKnowledgeTool } from "./knowledge/search-knowledge";
export { MockEmbeddings, MOCK_EMBEDDING_DIMENSION } from "./knowledge/mock-embeddings";
export { chunkMarkdown } from "./knowledge/chunk-markdown";
export type { MarkdownChunk } from "./knowledge/chunk-markdown";
export type {
  SearchKnowledgeToolOptions,
  ResolvedSearchKnowledgeToolOptions,
  KnowledgeRootResolver,
} from "./knowledge/options";
```

- [ ] **Step 4: Full package verification, then commit**

Run: `pnpm --filter @harpua/agent-tools build lint test`
Expected: all green (existing suites + 5 new knowledge suites).

```bash
git add packages/agent-tools/src/index.ts packages/agent-tools/src/__tests__/knowledge-loop.spec.ts
git commit -m "feat(agent-tools): knowledge family public exports and web-research loop test"
```

---

### Task 7: README, changeset, ROOT-protocol verification

**Files:**
- Modify: `packages/agent-tools/README.md` (new family subsection under `## Tools`, after the web-research section)
- Create: `.changeset/knowledge-tools.md` (repo root)

**Interfaces:**
- Consumes: everything shipped in Tasks 1–6.
- Produces: docs + release artifact; the verified finish line. (Push/PR is the controller's step, not this task's.)

- [ ] **Step 1: Add the README section**

Read `packages/agent-tools/README.md` first and match the existing family subsections' heading depth and voice (note the web-research section may have been edited since this plan was written — place after it, mirror its current style). Content requirements:

```markdown
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
fingerprint and triggers a clean re-index — vector spaces never mix. The
index is a cache: delete `.knowledge/` any time; markdown stays the source
of truth. First runtime dependency alert: this family adds `ml-distance`
(pure JS) for cosine similarity.
```

(`@langchain/openai` in the example is illustrative for consumers — it is NOT added to this package.)

- [ ] **Step 2: Add the changeset**

Create `.changeset/knowledge-tools.md`:

```markdown
---
"@harpua/agent-tools": patch
---

Add the knowledge tool family: `search_knowledge` performs chunk/embed/index/cosine retrieval over a markdown sources directory (the corpus `fetch_url`/`fetch_pdf` build), with heading-aware chunks, true file:line provenance, a lazily-refreshed hidden sidecar index, and a deterministic keyless `MockEmbeddings` default (pass any LangChain embeddings instance for real semantics). NOTE: this adds the package's first runtime dependency, `ml-distance` (pure JS, cosine similarity).
```

- [ ] **Step 3: ROOT-protocol verification**

From `/Users/leathcooper/ai-workspace/harpua-worktrees/feat-knowledge-tools`:

Run: `pnpm turbo build lint test --force`
Expected: every package green. Per-package runs are NOT sufficient for the finish line.

- [ ] **Step 4: Confirm the dependency delta is exactly one package**

Run: `git diff origin/main -- packages/agent-tools/package.json`
Expected: ONLY the `dependencies` block with `ml-distance` (plus lockfile changes committed in Task 5). Anything else is a defect.

- [ ] **Step 5: Commit**

```bash
git add packages/agent-tools/README.md .changeset/knowledge-tools.md
git commit -m "docs(agent-tools): document the knowledge family; add changeset"
```
