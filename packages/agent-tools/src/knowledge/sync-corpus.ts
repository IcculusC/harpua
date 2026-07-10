import type { EmbeddingsInterface } from "@langchain/core/embeddings";
import { ingest } from "./ingest";
import { readMarkdownDir } from "./markdown-dir-source";
import type { VectorStore } from "./vector-store";

/**
 * Full ingest of a markdown corpus into any VectorStore. Now a thin source
 * adapter over `ingest`: read the folder into documents, then chunk/embed/
 * upsert. NOT incremental (an LCD store exposes no prior hashes) — call it on
 * setup / on change; it's idempotent by record id. The built-in corpus
 * retrieval (`queryCorpus`) does its own incremental sync internally, so you
 * only need this to feed a different store (e.g. pgvector) from a markdown folder.
 */
export async function syncCorpus(args: {
  root: string;
  embeddings: EmbeddingsInterface;
  maxChunkChars: number;
  store: VectorStore;
}): Promise<{ upserted: number }> {
  return ingest(readMarkdownDir(args.root), {
    embeddings: args.embeddings,
    store: args.store,
    maxChunkChars: args.maxChunkChars,
  });
}
