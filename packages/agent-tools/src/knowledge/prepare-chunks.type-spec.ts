// Compile-only assertions for the prepareChunks surface. Excluded from the
// build (tsconfig.build.json); verified via `tsc -p tsconfig.json --noEmit`.
import type { PrepareChunksOptions, PreparedChunk, prepareChunks } from "./prepare-chunks";

// Every option is optional (defaults applied by the schema).
const _optsMinimal: PrepareChunksOptions = {};
const _optsFull: PrepareChunksOptions = {
  maxChunkChars: 800,
  minAlnumChars: 8,
  embedHeadingTrail: true,
  sanitize: (text: string) => text.trim(),
};

// prepareChunks returns PreparedChunk[] synchronously — no Promise, no
// embedding/storage side effects (the pure half of ingest).
type Returns = ReturnType<typeof prepareChunks>;
const _ret: Returns = [] as PreparedChunk[];

void _optsMinimal;
void _optsFull;
void _ret;
export {};
