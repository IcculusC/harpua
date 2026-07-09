import type { EmbeddingsInterface } from "@langchain/core/embeddings";

/** Dimension of the mock's hashed bag-of-words vectors. */
export const MOCK_EMBEDDING_DIMENSION = 256;

/**
 * FNV-1a 32-bit hash. Deliberately parallels the private helper in
 * `../web-research/save-page.ts` (8 lines of a standard algorithm) rather
 * than coupling the families through a shared module.
 */
function fnv1a(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash;
}

/**
 * The MockChatModel of embeddings: a deterministic, offline, dependency-free
 * stand-in implementing LangChain's `EmbeddingsInterface`. Lowercased word
 * tokens are feature-hashed into a fixed-dimension vector, L2-normalized.
 * Word overlap → higher cosine. This is LEXICAL similarity for keyless boot
 * and tests — not a semantic embedder; pass a real embeddings instance
 * (e.g. OpenRouter's endpoint via `OpenAIEmbeddings`) for real semantics.
 */
export class MockEmbeddings implements EmbeddingsInterface {
  async embedDocuments(documents: string[]): Promise<number[][]> {
    return documents.map((document) => this.vectorFor(document));
  }

  async embedQuery(document: string): Promise<number[]> {
    return this.vectorFor(document);
  }

  private vectorFor(text: string): number[] {
    const vector = new Array<number>(MOCK_EMBEDDING_DIMENSION).fill(0);
    const words = text.toLowerCase().match(/[a-z0-9]+/g) ?? [];
    for (const word of words) {
      vector[fnv1a(word) % MOCK_EMBEDDING_DIMENSION]! += 1;
    }
    const norm = Math.sqrt(vector.reduce((sum, v) => sum + v * v, 0));
    if (norm === 0) return vector;
    return vector.map((v) => v / norm);
  }
}
