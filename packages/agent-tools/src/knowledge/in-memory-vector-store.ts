import { similarity } from "ml-distance";
import type { BaseQueryOptions, VectorMatch, VectorRecord, VectorStore } from "./vector-store";

export interface InMemoryQueryOptions {
  minScore?: number;
}
export interface InMemoryVectorStoreDefaults extends BaseQueryOptions, InMemoryQueryOptions {}

/**
 * A records-only VectorStore backed by an in-memory Map. The reference adapter
 * and the test double: upsert by id, cosine query. No corpus concept.
 */
export class InMemoryVectorStore implements VectorStore<InMemoryQueryOptions> {
  private readonly records = new Map<string, VectorRecord>();
  constructor(private readonly defaults: InMemoryVectorStoreDefaults = {}) {}

  async upsert(records: VectorRecord[]): Promise<void> {
    for (const r of records) this.records.set(r.id, r);
  }

  async query(
    vector: number[],
    opts?: BaseQueryOptions & Partial<InMemoryQueryOptions>,
  ): Promise<VectorMatch[]> {
    const topK = opts?.topK ?? this.defaults.topK ?? 5;
    const minScore = opts?.minScore ?? this.defaults.minScore;
    return [...this.records.values()]
      .map((r) => ({
        id: r.id,
        score: similarity.cosine(vector, r.vector),
        text: r.text,
        metadata: r.metadata,
      }))
      .filter((m) => Number.isFinite(m.score) && (minScore === undefined || m.score >= minScore))
      .sort((a, b) => b.score - a.score)
      .slice(0, topK);
  }

  async deleteByDocumentKey(documentKey: string): Promise<void> {
    for (const [id, r] of [...this.records]) {
      if (r.documentKey === documentKey) this.records.delete(id);
    }
  }
}
