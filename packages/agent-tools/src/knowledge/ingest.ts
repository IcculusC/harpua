import type { EmbeddingsInterface } from "@langchain/core/embeddings";
import { z } from "zod";
import { chunkMarkdown, type MarkdownChunk } from "./chunk-markdown";
import { contentHash } from "./content-hash";
import { embeddingTextFor } from "./knowledge-index";
import {
  DEFAULT_INGEST_BATCH_SIZE,
  DEFAULT_MAX_CHUNK_CHARS,
  embeddingsSchema,
  vectorStoreSchema,
} from "./options";
import { stripControlChars } from "./sanitize-chunk-text";
import type { VectorRecord } from "./vector-store";

/** A retrievable unit from any source. Omit `id` and ingest derives a
 *  content-hash id, so byte-identical text dedupes across sources. */
export const documentSchema = z.object({
  id: z.string().optional(),
  text: z.string(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});
export type Document = z.infer<typeof documentSchema>;

export const ingestOptionsSchema = z
  .object({
    embeddings: embeddingsSchema,
    store: vectorStoreSchema,
    /** Chunk size cap; defaults to DEFAULT_MAX_CHUNK_CHARS (1200). */
    maxChunkChars: z.number().int().positive().optional(),
    /**
     * Junk floor: drop chunks with fewer ALPHANUMERIC characters (letters +
     * digits, not raw length) than this. `0` (default) keeps everything.
     * Calibration: "| 200-400mA | 5V |" carries 10 alnum chars and survives a
     * floor of 8; "---" and heading-only stubs carry 0-6 and are embedding junk.
     */
    minAlnumChars: z.number().int().nonnegative().default(0),
    /**
     * When true, the EMBEDDED text becomes
     * `"<headingTrail joined with ' > '>: <chunk text>"` (raw chunk text when
     * the trail is empty); the STORED text stays the raw chunk text either
     * way. Default false keeps the legacy embedding input: heading trail +
     * body joined by newlines ({@link embeddingTextFor}).
     */
    embedHeadingTrail: z.boolean().default(false),
    /**
     * Max records per `embedDocuments` and per `upsert` call. Defaults to
     * DEFAULT_INGEST_BATCH_SIZE (64) — one giant call for thousands of chunks
     * has crashed node natively in the field.
     */
    batchSize: z.number().int().positive().default(DEFAULT_INGEST_BATCH_SIZE),
    /**
     * Applied to each chunk's text before everything else (junk floor,
     * embedding, storage). Defaults to {@link stripControlChars}: C0/C1
     * control characters removed, `\t` and `\n` kept.
     */
    sanitize: z
      .custom<(text: string) => string>(
        (v) => typeof v === "function",
        "sanitize must be a function (text: string) => string",
      )
      .default(() => stripControlChars),
  })
  .strict();
/** Caller-facing options: everything beyond embeddings + store is defaulted. */
export type IngestOptions = z.input<typeof ingestOptionsSchema>;

export interface IngestResult {
  /** Total chunk-records upserted across all documents. */
  upserted: number;
}

/** Alphanumeric (letter/digit) count — the junk-floor metric. */
function countAlnum(text: string): number {
  return text.match(/[\p{L}\p{N}]/gu)?.length ?? 0;
}

/**
 * What the embedder sees for one chunk. Legacy default: heading trail + body
 * joined by newlines. With `embedHeadingTrail`: `"Trail > Path: body"` —
 * a compact single-line context prefix; trail-less chunks embed as-is.
 */
function embeddingInputFor(chunk: MarkdownChunk, embedHeadingTrail: boolean): string {
  if (!embedHeadingTrail) return embeddingTextFor(chunk);
  if (chunk.headingTrail.length === 0) return chunk.text;
  return `${chunk.headingTrail.join(" > ")}: ${chunk.text}`;
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
 * Source-agnostic RAG ingest: chunk each document, sanitize + junk-filter the
 * chunks, embed them (batched), and upsert the records (batched) into the
 * caller's VectorStore. Sources are plain data — a markdown folder, a web
 * excerpt, a notebook cell — with no disk round-trip. Push-only (upsert); a
 * document with no id is keyed by a content hash. Inputs are zod-validated at
 * the boundary before any embedding work. Every record carries
 * `metadata.chunkIndex`, sequential per document and DENSE after the junk
 * filter (0,1,2,… with no gaps) — the handle for retrieval-time window
 * expansion (see the README recipe).
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
  const cap = maxChunkChars ?? DEFAULT_MAX_CHUNK_CHARS;
  const records: VectorRecord[] = [];
  const explicitIds = new Set<string>();

  for (const doc of docs) {
    // Mark every explicit-id doc for cleanup, even if it produces no chunks —
    // re-ingesting a doc as empty should clear its prior records.
    if (doc.id !== undefined) explicitIds.add(doc.id);
    const chunks = chunkMarkdown(doc.text, { maxChunkChars: cap })
      // The trail is sanitized too: it reaches the embedder (both modes) and
      // the stored metadata — a dirty scraped heading would otherwise
      // re-introduce exactly the bytes the sanitizer exists to remove.
      .map((chunk) => ({
        ...chunk,
        text: sanitize(chunk.text),
        headingTrail: chunk.headingTrail.map(sanitize),
      }))
      .filter((chunk) => countAlnum(chunk.text) >= minAlnumChars);
    if (chunks.length === 0) continue;
    const baseId = doc.id ?? contentHash(doc.text);
    const vectors = await embedInBatches(
      embeddings,
      chunks.map((chunk) => embeddingInputFor(chunk, embedHeadingTrail)),
      batchSize,
    );
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
          chunkIndex: i,
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
