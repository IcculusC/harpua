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
  /**
   * `<embedder constructor name>:<model ?? "-">:<vector dimension>:<maxChunkChars>`
   * — any mismatch means a full rebuild (vector spaces must never mix, and
   * chunk geometry from a different `maxChunkChars` invalidates just as hard).
   */
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

/** `<ctor name>:<model ?? "-">` — the part of the identity known before embedding. */
function embedderNameAndModel(embeddings: EmbeddingsInterface): string {
  const name = (embeddings as object).constructor?.name ?? "unknown";
  const model = (embeddings as { model?: unknown }).model;
  const modelId = typeof model === "string" && model.length > 0 ? model : "-";
  return `${name}:${modelId}`;
}

/**
 * The single source of embedder identity: constructor name + `model`
 * (LangChain embedders like `OpenAIEmbeddings` expose this; different
 * models must never share a fingerprint) + vector dimension.
 */
function embedderIdOf(embeddings: EmbeddingsInterface, dimension: number): string {
  return `${embedderNameAndModel(embeddings)}:${dimension}`;
}

/** Full stored fingerprint: embedder identity + the chunk geometry it was built with. */
function computeFingerprint(
  embeddings: EmbeddingsInterface,
  dimension: number,
  maxChunkChars: number,
): string {
  return `${embedderIdOf(embeddings, dimension)}:${maxChunkChars}`;
}

interface ParsedFingerprint {
  nameAndModel: string;
  dimension: number;
  maxChunkChars: number;
}

function parseFingerprint(fingerprint: string): ParsedFingerprint | null {
  const parts = fingerprint.split(":");
  if (parts.length !== 4) return null;
  const [name, model, dim, maxChars] = parts;
  return {
    nameAndModel: `${name}:${model}`,
    dimension: Number(dim),
    maxChunkChars: Number(maxChars),
  };
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

/** Write `content` atomically: temp file in the same dir, then rename over the target. */
function writeFileAtomic(targetPath: string, content: string): void {
  const dir = path.dirname(targetPath);
  const tmpPath = path.join(
    dir,
    `.${path.basename(targetPath)}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`,
  );
  fs.writeFileSync(tmpPath, content);
  try {
    fs.renameSync(tmpPath, targetPath);
  } catch (err) {
    try {
      fs.rmSync(tmpPath, { force: true });
    } catch {
      // best-effort cleanup only
    }
    throw err;
  }
}

/**
 * Bring the sidecar index at `<root>/.knowledge/index.json` up to date:
 * re-chunk + re-embed only new/changed files, drop deleted ones, rebuild
 * everything when the embedder fingerprint (constructor name, `model` when
 * present, vector dimension, and `maxChunkChars`) differs — vector spaces
 * must never mix, and neither may chunk geometry silently drift. Rejects if
 * the embedder itself fails, or if it returns a different number of vectors
 * than chunks requested (a broken embedder contract) — nothing is persisted
 * in that case. A filesystem write failure is otherwise reported in
 * `persistError` and the in-memory index is still returned. Persistence is
 * skipped entirely when nothing changed (dirty-flag check) or when the
 * corpus has no markdown files and no prior index exists on disk (a
 * mistyped root must not create directories).
 */
export async function syncIndex(args: {
  root: string;
  embeddings: EmbeddingsInterface;
  maxChunkChars: number;
  /** Known query-vector dimension; forces a rebuild when stored vectors differ. */
  expectedDimension?: number;
}): Promise<SyncResult> {
  const indexPath = path.join(args.root, ".knowledge", "index.json");
  const indexFileExisted = fs.existsSync(indexPath);
  const loaded = loadIndex(indexPath);
  let existing = loaded;

  // Fingerprint pre-checks against the existing index — everything knowable
  // before embedding: identity (name + model) and chunk geometry, plus
  // dimension when the caller already knows it (e.g. from the query vector).
  if (existing) {
    const parsed = parseFingerprint(existing.fingerprint);
    const currentNameAndModel = embedderNameAndModel(args.embeddings);
    const identityMismatch = parsed === null || parsed.nameAndModel !== currentNameAndModel;
    const maxCharsMismatch = parsed !== null && parsed.maxChunkChars !== args.maxChunkChars;
    const dimensionMismatch =
      parsed !== null &&
      args.expectedDimension !== undefined &&
      parsed.dimension !== args.expectedDimension;
    if (identityMismatch || maxCharsMismatch || dimensionMismatch) existing = null;
  }

  const files = listMarkdownFiles(args.root);
  const next: KnowledgeIndex = {
    version: INDEX_VERSION,
    fingerprint: existing?.fingerprint ?? "",
    files: {},
  };

  let dimension = existing ? parseFingerprint(existing.fingerprint)?.dimension : undefined;
  let anyFileChanged = false;

  for (const name of files) {
    const content = fs.readFileSync(path.join(args.root, name), "utf8");
    const hash = sha256(content);
    const previous = existing?.files[name];
    if (previous && previous.hash === hash) {
      next.files[name] = previous;
      continue;
    }
    anyFileChanged = true;
    const chunks = chunkMarkdown(content, { maxChunkChars: args.maxChunkChars });
    if (chunks.length === 0) {
      next.files[name] = { hash, chunks: [] };
      continue;
    }
    const vectors = await args.embeddings.embedDocuments(chunks.map(embeddingTextFor));
    if (vectors.length !== chunks.length) {
      throw new Error(
        `search_knowledge: embedder returned ${vectors.length} vectors for ` +
          `${chunks.length} chunks in "${name}" — embedDocuments must return one ` +
          "vector per input text.",
      );
    }
    next.files[name] = {
      hash,
      chunks: chunks.map((chunk, i) => ({ ...chunk, vector: vectors[i]! })),
    };
    dimension = vectors[0]?.length ?? dimension;
  }

  next.fingerprint = computeFingerprint(
    args.embeddings,
    dimension ?? args.expectedDimension ?? 0,
    args.maxChunkChars,
  );

  const droppedAny = existing
    ? Object.keys(existing.files).some((name) => !(name in next.files))
    : false;
  const fingerprintChanged = next.fingerprint !== (loaded?.fingerprint ?? "");
  const dirty = fingerprintChanged || anyFileChanged || droppedAny;

  const noCorpusAndNoPriorIndex = files.length === 0 && !indexFileExisted;

  let persistError: string | undefined;
  if (dirty && !noCorpusAndNoPriorIndex) {
    try {
      fs.mkdirSync(path.dirname(indexPath), { recursive: true });
      writeFileAtomic(indexPath, JSON.stringify(next));
    } catch (err) {
      persistError = err instanceof Error ? err.message : String(err);
    }
  }
  return { index: next, persistError };
}
