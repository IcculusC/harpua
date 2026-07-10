import { z } from "zod";
import { chunkMarkdown } from "./chunk-markdown";
import { contentHash } from "./content-hash";
import { embeddingTextFor } from "./knowledge-index";
import {
  DEFAULT_MAX_CHUNK_CHARS,
  embeddingsSchema,
  vectorStoreSchema,
} from "./options";
import type { VectorRecord } from "./vector-store";

/** A retrievable unit from any source. Omit `id` and ingest derives a
 *  content-hash id, so byte-identical text dedupes across sources. */
export const documentSchema = z.object({
  id: z.string().optional(),
  text: z.string(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});
export type Document = z.infer<typeof documentSchema>;

export const ingestOptionsSchema = z.object({
  embeddings: embeddingsSchema,
  store: vectorStoreSchema,
  /** Chunk size cap; defaults to DEFAULT_MAX_CHUNK_CHARS (1200). */
  maxChunkChars: z.number().int().positive().optional(),
});
export type IngestOptions = z.infer<typeof ingestOptionsSchema>;

export interface IngestResult {
  /** Total chunk-records upserted across all documents. */
  upserted: number;
}

/**
 * Source-agnostic RAG ingest: chunk each document, embed each chunk, and
 * upsert the records into the caller's VectorStore. Sources are plain data —
 * a markdown folder, a web excerpt, a notebook cell — with no disk round-trip.
 * Push-only (upsert); a document with no id is keyed by a content hash.
 * Inputs are zod-validated at the boundary before any embedding work.
 */
export async function ingest(
  documents: Document[],
  opts: IngestOptions,
): Promise<IngestResult> {
  const docs = z.array(documentSchema).parse(documents);
  const { embeddings, store, maxChunkChars } = ingestOptionsSchema.parse(opts);
  const cap = maxChunkChars ?? DEFAULT_MAX_CHUNK_CHARS;
  const records: VectorRecord[] = [];
  const explicitIds = new Set<string>();

  for (const doc of docs) {
    // Mark every explicit-id doc for cleanup, even if it produces no chunks —
    // re-ingesting a doc as empty should clear its prior records.
    if (doc.id !== undefined) explicitIds.add(doc.id);
    const chunks = chunkMarkdown(doc.text, { maxChunkChars: cap });
    if (chunks.length === 0) continue;
    const baseId = doc.id ?? contentHash(doc.text);
    const vectors = await embeddings.embedDocuments(chunks.map(embeddingTextFor));
    chunks.forEach((chunk, i) => {
      records.push({
        id: `${baseId}:${i}`,
        documentKey: baseId,
        vector: vectors[i]!,
        text: chunk.text,
        metadata: {
          ...doc.metadata,
          startLine: chunk.startLine,
          endLine: chunk.endLine,
          headingTrail: chunk.headingTrail,
        },
      });
    });
  }

  // Hygiene: clear prior records for the explicit-id docs we're (re)writing, so
  // a shrunk doc leaves no orphaned tail. After embedding (an embed failure
  // throws before any store mutation); id-less docs are immutable-append and
  // never cleared. The document key for an explicit doc is its id.
  for (const id of explicitIds) await store.deleteByDocumentKey(id);
  if (records.length > 0) await store.upsert(records);
  return { upserted: records.length };
}
