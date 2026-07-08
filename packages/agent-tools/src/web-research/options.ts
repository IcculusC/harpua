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

/** Caller-facing options: `baseUrl` required, every cap optional (defaults apply). */
export type WebSearchToolOptions = z.input<typeof webSearchToolOptionsSchema>;
/** Fully-resolved options with all defaults applied. */
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

/** Caller-facing options: `saveDir` required, every cap optional (defaults apply). */
export type FetchUrlToolOptions = z.input<typeof fetchUrlToolOptionsSchema>;
/** Fully-resolved options with all defaults applied. */
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
