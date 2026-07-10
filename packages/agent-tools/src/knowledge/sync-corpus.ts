import fs from "node:fs";
import path from "node:path";
import type { EmbeddingsInterface } from "@langchain/core/embeddings";
import { chunkMarkdown } from "./chunk-markdown";
import { embeddingTextFor } from "./knowledge-index";
import type { VectorRecord, VectorStore } from "./vector-store";

/**
 * Full ingest of a markdown corpus into any VectorStore: list `*.md`, chunk,
 * embed, upsert. NOT incremental (an LCD store exposes no prior hashes) — call
 * it on setup / on change; it's idempotent by record id. The built-in corpus
 * retrieval (`queryCorpus`) does its own incremental sync internally, so you
 * only need this to feed a different store (e.g. pgvector) from a markdown folder.
 */
export async function syncCorpus(args: {
  root: string;
  embeddings: EmbeddingsInterface;
  maxChunkChars: number;
  store: VectorStore;
}): Promise<{ upserted: number }> {
  let names: string[];
  try {
    names = fs
      .readdirSync(args.root, { withFileTypes: true })
      .filter((e) => e.isFile() && e.name.endsWith(".md"))
      .map((e) => e.name)
      .sort();
  } catch {
    return { upserted: 0 }; // missing corpus dir → nothing to ingest
  }

  const records: VectorRecord[] = [];
  for (const file of names) {
    const content = fs.readFileSync(path.join(args.root, file), "utf8");
    const chunks = chunkMarkdown(content, { maxChunkChars: args.maxChunkChars });
    if (chunks.length === 0) continue;
    const vectors = await args.embeddings.embedDocuments(chunks.map(embeddingTextFor));
    chunks.forEach((chunk, i) => {
      records.push({
        id: `${file}:${i}`,
        vector: vectors[i]!,
        text: chunk.text,
        metadata: {
          file,
          startLine: chunk.startLine,
          endLine: chunk.endLine,
          headingTrail: chunk.headingTrail,
        },
      });
    });
  }
  if (records.length > 0) await args.store.upsert(records);
  return { upserted: records.length };
}
