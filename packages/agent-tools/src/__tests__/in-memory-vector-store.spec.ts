import { InMemoryVectorStore } from "../knowledge/in-memory-vector-store";
import { vectorStoreSchema } from "../knowledge/options";

const rec = (id: string, vector: number[], text = id) => ({ id, documentKey: id, vector, text });

describe("InMemoryVectorStore", () => {
  it("upserts then returns scored, sorted, top-K matches", async () => {
    const s = new InMemoryVectorStore({ topK: 2 });
    await s.upsert([rec("a", [1, 0]), rec("b", [0.9, 0.1]), rec("c", [0, 1])]);
    const hits = await s.query([1, 0]);
    expect(hits.map((h) => h.id)).toEqual(["a", "b"]); // top-2 by cosine
    expect(hits[0]!.score).toBeGreaterThan(hits[1]!.score);
    expect(hits[0]!.text).toBe("a");
  });

  it("per-call opts override the constructor defaults", async () => {
    const s = new InMemoryVectorStore({ topK: 1 });
    await s.upsert([rec("a", [1, 0]), rec("b", [0.9, 0.1])]);
    expect(await s.query([1, 0])).toHaveLength(1); // default topK
    expect(await s.query([1, 0], { topK: 2 })).toHaveLength(2); // override
  });

  it("upsert is idempotent by id (last write wins)", async () => {
    const s = new InMemoryVectorStore({ topK: 5 });
    await s.upsert([rec("a", [1, 0], "old")]);
    await s.upsert([rec("a", [1, 0], "new")]);
    const hits = await s.query([1, 0]);
    expect(hits).toHaveLength(1);
    expect(hits[0]!.text).toBe("new");
  });

  it("drops matches below minScore (per-call)", async () => {
    const s = new InMemoryVectorStore({ topK: 5 });
    await s.upsert([rec("a", [1, 0]), rec("c", [0, 1])]);
    const hits = await s.query([1, 0], { minScore: 0.5 });
    expect(hits.map((h) => h.id)).toEqual(["a"]); // c scores ~0
  });

  it("deleteByDocumentKey removes records with that key, leaves the rest", async () => {
    const s = new InMemoryVectorStore({ topK: 50 });
    await s.upsert([
      { id: "a:0", documentKey: "a", vector: [1, 0], text: "a0" },
      { id: "a:1", documentKey: "a", vector: [0.9, 0.1], text: "a1" },
      { id: "b:0", documentKey: "b", vector: [0, 1], text: "b0" },
    ]);
    await s.deleteByDocumentKey("a");
    const ids = (await s.query([1, 0], { topK: 50 })).map((m) => m.id).sort();
    expect(ids).toEqual(["b:0"]);
  });
});

describe("vectorStoreSchema", () => {
  it("requires deleteByDocumentKey (rejects an upsert+query-only object)", () => {
    const partial = { upsert: async () => {}, query: async () => [] };
    expect(vectorStoreSchema.safeParse(partial).success).toBe(false);
    expect(vectorStoreSchema.safeParse(new InMemoryVectorStore()).success).toBe(true);
  });
});
