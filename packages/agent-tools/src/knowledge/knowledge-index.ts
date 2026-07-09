import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import type { EmbeddingsInterface } from "@langchain/core/embeddings";

import { chunkMarkdown, type MarkdownChunk } from "./chunk-markdown";

export const INDEX_VERSION = 1 as const;

export interface IndexedChunk extends MarkdownChunk {
  vector: number[];
}

export interface KnowledgeIndex {
  version: typeof INDEX_VERSION;
  /** `<embedder constructor name>:<vector dimension>` — mismatch → rebuild. */
  fingerprint: string;
  files: Record<string, { hash: string; chunks: IndexedChunk[] }>;
}

export interface SyncResult {
  index: KnowledgeIndex;
  /** Set when the index could not be written back; the in-memory index is still valid. */
  persistError?: string;
}

/** The text a chunk is embedded as: heading context + body. */
export function embeddingTextFor(chunk: MarkdownChunk): string {
  return [...chunk.headingTrail, chunk.text].join("\n");
}

function sha256(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

function fingerprintOf(embeddings: EmbeddingsInterface, dimension: number): string {
  const name = (embeddings as object).constructor?.name ?? "unknown";
  return `${name}:${dimension}`;
}

function loadIndex(indexPath: string): KnowledgeIndex | null {
  try {
    const parsed = JSON.parse(fs.readFileSync(indexPath, "utf8")) as KnowledgeIndex;
    return parsed.version === INDEX_VERSION && typeof parsed.files === "object"
      ? parsed
      : null;
  } catch {
    return null; // absent or corrupt — the sidecar is only a cache
  }
}

function listMarkdownFiles(root: string): string[] {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return []; // missing corpus dir → empty corpus
  }
  return entries
    .filter((e) => e.isFile() && e.name.endsWith(".md"))
    .map((e) => e.name)
    .sort();
}

/**
 * Bring the sidecar index at `<root>/.knowledge/index.json` up to date:
 * re-chunk + re-embed only new/changed files, drop deleted ones, rebuild
 * everything when the embedder fingerprint (constructor name + vector
 * dimension) differs — vector spaces must never mix. Rejects only if the
 * embedder itself fails; a filesystem write failure is reported in
 * `persistError` and the in-memory index is still returned.
 */
export async function syncIndex(args: {
  root: string;
  embeddings: EmbeddingsInterface;
  maxChunkChars: number;
  /** Known query-vector dimension; forces a rebuild when stored vectors differ. */
  expectedDimension?: number;
}): Promise<SyncResult> {
  const indexPath = path.join(args.root, ".knowledge", "index.json");
  let existing = loadIndex(indexPath);

  // Fingerprint pre-checks against the existing index.
  if (existing) {
    const [name] = existing.fingerprint.split(":");
    const currentName = (args.embeddings as object).constructor?.name ?? "unknown";
    const storedDimension = Number(existing.fingerprint.split(":")[1]);
    const dimensionMismatch =
      args.expectedDimension !== undefined && storedDimension !== args.expectedDimension;
    if (name !== currentName || dimensionMismatch) existing = null;
  }

  const files = listMarkdownFiles(args.root);
  const next: KnowledgeIndex = {
    version: INDEX_VERSION,
    fingerprint: existing?.fingerprint ?? "",
    files: {},
  };

  let dimension = existing ? Number(existing.fingerprint.split(":")[1]) : undefined;

  for (const name of files) {
    const content = fs.readFileSync(path.join(args.root, name), "utf8");
    const hash = sha256(content);
    const previous = existing?.files[name];
    if (previous && previous.hash === hash) {
      next.files[name] = previous;
      continue;
    }
    const chunks = chunkMarkdown(content, { maxChunkChars: args.maxChunkChars });
    if (chunks.length === 0) {
      next.files[name] = { hash, chunks: [] };
      continue;
    }
    const vectors = await args.embeddings.embedDocuments(chunks.map(embeddingTextFor));
    next.files[name] = {
      hash,
      chunks: chunks.map((chunk, i) => ({ ...chunk, vector: vectors[i] ?? [] })),
    };
    dimension = vectors[0]?.length ?? dimension;
  }

  next.fingerprint = fingerprintOf(args.embeddings, dimension ?? args.expectedDimension ?? 0);

  let persistError: string | undefined;
  try {
    fs.mkdirSync(path.dirname(indexPath), { recursive: true });
    fs.writeFileSync(indexPath, JSON.stringify(next));
  } catch (err) {
    persistError = err instanceof Error ? err.message : String(err);
  }
  return { index: next, persistError };
}
