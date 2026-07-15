import { z } from "zod";
import { chunkMarkdown, type MarkdownChunk } from "./chunk-markdown";
import { embeddingTextFor } from "./knowledge-index";
import { DEFAULT_MAX_CHUNK_CHARS } from "./options";
import { stripControlChars } from "./sanitize-chunk-text";

/**
 * One prepared chunk: sanitized + junk-filtered `text` (what {@link ingest}
 * stores), the exact `embedText` an embedder should see, and the same
 * line/heading provenance {@link chunkMarkdown} produces. `chunkIndex` is
 * sequential per call and DENSE after the junk filter (0, 1, 2, … with no
 * gaps) — the same numbering `ingest` stamps into `metadata.chunkIndex`.
 */
export interface PreparedChunk {
  text: string;
  embedText: string;
  chunkIndex: number;
  startLine: number;
  endLine: number;
  headingTrail: string[];
}

export const prepareChunksOptionsSchema = z
  .object({
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
     * When true, `embedText` becomes
     * `"<headingTrail joined with ' > '>: <chunk text>"` (raw chunk text when
     * the trail is empty); `text` stays the raw chunk text either way.
     * Default false keeps the legacy embedding input: heading trail + body
     * joined by newlines ({@link embeddingTextFor}).
     */
    embedHeadingTrail: z.boolean().default(false),
    /**
     * Applied to each chunk's text before everything else (junk floor,
     * embedText, text). Defaults to {@link stripControlChars}: C0/C1
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
/** Caller-facing options: everything is defaulted. */
export type PrepareChunksOptions = z.input<typeof prepareChunksOptionsSchema>;
/** Fully-resolved options with all defaults applied. */
export type ResolvedPrepareChunksOptions = z.output<typeof prepareChunksOptionsSchema>;

/** Alphanumeric (letter/digit) count — the junk-floor metric. */
function countAlnum(text: string): number {
  return text.match(/[\p{L}\p{N}]/gu)?.length ?? 0;
}

/**
 * What the embedder sees for one chunk. Legacy default: heading trail + body
 * joined by newlines. With `embedHeadingTrail`: `"Trail > Path: body"` —
 * a compact single-line context prefix; trail-less chunks embed as-is.
 */
function embedTextFor(chunk: MarkdownChunk, embedHeadingTrail: boolean): string {
  if (!embedHeadingTrail) return embeddingTextFor(chunk);
  if (chunk.headingTrail.length === 0) return chunk.text;
  return `${chunk.headingTrail.join(" > ")}: ${chunk.text}`;
}

/**
 * Pure chunk-prep half of {@link ingest}: chunk → sanitize → junk-filter →
 * embed-text formatting, with NO embedding or storage. `ingest` composes over
 * this function; a consumer running its own embed/upsert path (a separate
 * collection, a different provider) calls it directly instead of re-deriving
 * chunk geometry and embedding-input formatting from `chunkMarkdown` by hand.
 * Options are zod-validated at call time — same knobs, same defaults, same
 * strict unknown-key rejection as `ingest`'s chunking options.
 */
export function prepareChunks(
  markdown: string,
  options?: PrepareChunksOptions,
): PreparedChunk[] {
  return prepareChunksFromResolvedOptions(
    markdown,
    prepareChunksOptionsSchema.parse(options ?? {}),
  );
}

/**
 * INTERNAL — same pipeline as {@link prepareChunks} but skips the
 * `prepareChunksOptionsSchema.parse()` call, taking already-resolved options
 * instead. `ingest()` validates its full option surface (chunking knobs +
 * embed/upsert knobs) exactly once via `ingestOptionsSchema` before its
 * per-document loop; calling the public `prepareChunks` from inside that
 * loop would re-parse the same four already-validated knobs once per
 * document. Not exported from the package index — `ingest.ts` is the only
 * caller.
 */
export function prepareChunksFromResolvedOptions(
  markdown: string,
  options: ResolvedPrepareChunksOptions,
): PreparedChunk[] {
  const { maxChunkChars, minAlnumChars, embedHeadingTrail, sanitize } = options;
  const cap = maxChunkChars ?? DEFAULT_MAX_CHUNK_CHARS;
  return chunkMarkdown(markdown, { maxChunkChars: cap })
    // The trail is sanitized too: it reaches the embedder (both modes) and
    // the stored metadata — a dirty scraped heading would otherwise
    // re-introduce exactly the bytes the sanitizer exists to remove.
    .map((chunk) => ({
      ...chunk,
      text: sanitize(chunk.text),
      headingTrail: chunk.headingTrail.map(sanitize),
    }))
    .filter((chunk) => countAlnum(chunk.text) >= minAlnumChars)
    .map((chunk, chunkIndex) => ({
      text: chunk.text,
      embedText: embedTextFor(chunk, embedHeadingTrail),
      chunkIndex,
      startLine: chunk.startLine,
      endLine: chunk.endLine,
      headingTrail: chunk.headingTrail,
    }));
}
