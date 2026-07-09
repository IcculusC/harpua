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
