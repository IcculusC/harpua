// Compile-only assertions for the VectorStore typed generic `Q`.
// Excluded from the build (tsconfig.build.json); verified via
// `tsc -p tsconfig.json --noEmit`, which full-type-checks src.
import type { VectorStore } from "./vector-store";

// A pgvector-shaped adapter types its own knobs; the base only guarantees topK.
type PgQ = { where?: string; metric?: "cosine" | "l2" | "ip"; minScore?: number };
const _pg: VectorStore<PgQ> = {
  async upsert() {},
  async query(_v, opts) {
    void opts?.topK; // base knob
    void opts?.metric; // adapter knob — typed
    void opts?.where;
    void opts?.minScore;
    return [];
  },
  async deleteByDocumentKey() {},
};

// Base usage (the generic tool) sees only topK.
const _base: VectorStore = {
  async upsert() {},
  async query(_v, opts) {
    void opts?.topK;
    return [];
  },
  async deleteByDocumentKey() {},
};

void _pg;
void _base;
export {};
