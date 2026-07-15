import type { EmbeddingsInterface } from "@langchain/core/embeddings";
import { z } from "zod";
import { contentHash } from "./content-hash";
import { DEFAULT_INGEST_BATCH_SIZE, embeddingsSchema, vectorStoreSchema } from "./options";
import { prepareChunks, prepareChunksOptionsSchema } from "./prepare-chunks";
import type { VectorRecord } from "./vector-store";

/** A retrievable unit from any source. Omit `id` and ingest derives a
 *  content-hash id, so byte-identical text dedupes across sources. */
export const documentSchema = z.object({
  id: z.string().optional(),
  text: z.string(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});
export type Document = z.infer<typeof documentSchema>;

/**
 * `ingest`'s options are `prepareChunks`'s chunking knobs (maxChunkChars,
 * minAlnumChars, embedHeadingTrail, sanitize) plus the embed/upsert half:
 * `embeddings`, `store`, `batchSize`. One schema, one source of truth for
 * the chunking defaults shared by both entry points.
 */
export const ingestOptionsSchema = prepareChunksOptionsSchema
  .extend({
    embeddings: embeddingsSchema,
    store: vectorStoreSchema,
    /**
     * Max records per `embedDocuments` and per `upsert` call. Defaults to
     * DEFAULT_INGEST_BATCH_SIZE (64) — one giant call for thousands of chunks
     * has crashed node natively in the field.
     */
    batchSize: z.number().int().positive().default(DEFAULT_INGEST_BATCH_SIZE),
  })
  .strict();
/** Caller-facing options: everything beyond embeddings + store is defaulted. */
export type IngestOptions = z.input<typeof ingestOptionsSchema>;

export interface IngestResult {
  /** Total chunk-records upserted across all documents. */
  upserted: number;
}

/** Embed `texts` in slices of at most `batchSize` per provider call. */
async function embedInBatches(
  embeddings: EmbeddingsInterface,
  texts: string[],
  batchSize: number,
): Promise<number[][]> {
  const vectors: number[][] = [];
  for (let i = 0; i < texts.length; i += batchSize) {
    const slice = texts.slice(i, i + batchSize);
    const batch = await embeddings.embedDocuments(slice);
    if (batch.length !== slice.length) {
      // A short batch would silently shift the embed<->record pairing for
      // every chunk after it — fail loudly instead (same guard style as
      // knowledge-index).
      throw new Error(
        `ingest: embedDocuments returned ${batch.length} vectors for ` +
          `${slice.length} texts — provider/batch mismatch.`,
      );
    }
    vectors.push(...batch);
  }
  return vectors;
}

/**
 * Source-agnostic RAG ingest: composes {@link prepareChunks} (chunk →
 * sanitize → junk-filter → embed-text formatting) with embed (batched) and
 * upsert (batched) into the caller's VectorStore. Sources are plain data — a
 * markdown folder, a web excerpt, a notebook cell — with no disk round-trip.
 * Push-only (upsert); a document with no id is keyed by a content hash.
 * Inputs are zod-validated at the boundary before any embedding work. Every
 * record carries `metadata.chunkIndex`, sequential per document and DENSE
 * after the junk filter (0,1,2,… with no gaps) — the handle for
 * retrieval-time window expansion (see the README recipe).
 */
export async function ingest(
  documents: Document[],
  opts: IngestOptions,
): Promise<IngestResult> {
  const docs = z.array(documentSchema).parse(documents);
  const {
    embeddings,
    store,
    maxChunkChars,
    minAlnumChars,
    embedHeadingTrail,
    batchSize,
    sanitize,
  } = ingestOptionsSchema.parse(opts);
  const records: VectorRecord[] = [];
  const explicitIds = new Set<string>();

  for (const doc of docs) {
    // Mark every explicit-id doc for cleanup, even if it produces no chunks —
    // re-ingesting a doc as empty should clear its prior records.
    if (doc.id !== undefined) explicitIds.add(doc.id);
    const chunks = prepareChunks(doc.text, {
      maxChunkChars,
      minAlnumChars,
      embedHeadingTrail,
      sanitize,
    });
    if (chunks.length === 0) continue;
    const baseId = doc.id ?? contentHash(doc.text);
    const vectors = await embedInBatches(
      embeddings,
      chunks.map((chunk) => chunk.embedText),
      batchSize,
    );
    chunks.forEach((chunk) => {
      records.push({
        id: `${baseId}:${chunk.chunkIndex}`,
        documentKey: baseId,
        vector: vectors[chunk.chunkIndex]!,
        text: chunk.text,
        metadata: {
          ...doc.metadata,
          startLine: chunk.startLine,
          endLine: chunk.endLine,
          headingTrail: chunk.headingTrail,
          chunkIndex: chunk.chunkIndex,
        },
      });
    });
  }

  // Hygiene: clear prior records for the explicit-id docs we're (re)writing, so
  // a shrunk doc leaves no orphaned tail. After embedding (an embed failure
  // throws before any store mutation); id-less docs are immutable-append and
  // never cleared. The document key for an explicit doc is its id.
  for (const id of explicitIds) await store.deleteByDocumentKey(id);
  for (let i = 0; i < records.length; i += batchSize) {
    await store.upsert(records.slice(i, i + batchSize));
  }
  return { upserted: records.length };
}
