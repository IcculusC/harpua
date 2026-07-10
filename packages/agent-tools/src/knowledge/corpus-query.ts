import { similarity } from "ml-distance";
import type { EmbeddingsInterface } from "@langchain/core/embeddings";
import type { BaseQueryOptions, VectorMatch } from "./vector-store";
import { syncIndex } from "./knowledge-index";

export interface CorpusQueryArgs {
  root: string;
  embeddings: EmbeddingsInterface;
  maxChunkChars: number;
}

/**
 * The built-in default retrieval: run the existing incremental corpus sync
 * (markdown dir → fingerprinted index) and cosine-scan its chunks into
 * `VectorMatch[]`. NOT a VectorStore — a corpus index is not a records store;
 * the VectorStore port is for BYO backends. The sync/persist logic is reused
 * verbatim from `syncIndex`, so default behavior is byte-identical to today.
 */
export async function queryCorpus(
  args: CorpusQueryArgs,
  queryVector: number[],
  opts?: BaseQueryOptions & { minScore?: number },
): Promise<VectorMatch[]> {
  const topK = opts?.topK ?? 5;
  const minScore = opts?.minScore;

  const { index } = await syncIndex({
    root: args.root,
    embeddings: args.embeddings,
    maxChunkChars: args.maxChunkChars,
    expectedDimension: queryVector.length,
  });

  return Object.entries(index.files)
    .flatMap(([file, entry]) =>
      entry.chunks.map((chunk, i) => ({
        id: `${file}:${i}`,
        score: similarity.cosine(queryVector, chunk.vector),
        text: chunk.text,
        metadata: {
          file,
          startLine: chunk.startLine,
          endLine: chunk.endLine,
          headingTrail: chunk.headingTrail,
        },
      })),
    )
    .filter((m) => Number.isFinite(m.score) && (minScore === undefined || m.score >= minScore))
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);
}
