// Compile-only assertions for the ingest surface. Excluded from the build
// (tsconfig.build.json); verified via `tsc -p tsconfig.json --noEmit`.
import type { Document, IngestOptions, IngestResult, ingest } from "./ingest";

// id is optional; metadata is an open record.
const _idless: Document = { text: "excerpt with no id" };
const _full: Document = { id: "x", text: "t", metadata: { sourceUrl: "https://x" } };

// maxChunkChars is optional on options.
const _optsMinimal: Omit<IngestOptions, "embeddings" | "store"> = {};

// The chunking knobs are all optional (defaults applied by the schema), and
// sanitize is a plain text transform.
const _optsChunking: Omit<IngestOptions, "embeddings" | "store"> = {
  minAlnumChars: 8,
  embedHeadingTrail: true,
  batchSize: 128,
  sanitize: (text: string) => text.trim(),
};

// ingest returns Promise<IngestResult>.
type Returns = ReturnType<typeof ingest>;
const _ret: Returns = Promise.resolve<IngestResult>({ upserted: 0 });

void _idless;
void _full;
void _optsMinimal;
void _optsChunking;
void _ret;
export {};
