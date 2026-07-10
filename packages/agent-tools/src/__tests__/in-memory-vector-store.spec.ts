import { InMemoryVectorStore } from "../knowledge/in-memory-vector-store";

const rec = (id: string, vector: number[], text = id) => ({ id, vector, text });

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
});
