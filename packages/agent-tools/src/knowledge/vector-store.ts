export interface VectorRecord {
  id: string;
  vector: number[];
  text: string;
  metadata?: Record<string, unknown>;
}

export interface VectorMatch {
  id: string;
  score: number;
  text: string;
  metadata?: Record<string, unknown>;
}

/** The one guaranteed query knob. Omit `topK` to use the store's configured default. */
export interface BaseQueryOptions {
  topK?: number;
}

/**
 * Lowest-common-denominator vector store. `Q` is the adapter's own typed tuning
 * surface (metric, minScore, a real WHERE…) — harpua does not standardize it.
 * Per-call `opts` merge over the store's configured defaults; the adapter owns
 * the merge and interpretation. `query` returns already-scored, sorted, top-K
 * matches.
 */
export interface VectorStore<Q = Record<never, never>> {
  upsert(records: VectorRecord[]): Promise<void>;
  query(vector: number[], opts?: BaseQueryOptions & Partial<Q>): Promise<VectorMatch[]>;
}
