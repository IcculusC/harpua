import {
  MockEmbeddings,
  MOCK_EMBEDDING_DIMENSION,
} from "../knowledge/mock-embeddings";

function cosine(a: number[], b: number[]): number {
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += a[i]! * b[i]!;
  return dot; // vectors are unit-normalized, so dot product IS cosine
}

describe("MockEmbeddings", () => {
  const embeddings = new MockEmbeddings();

  it("is deterministic and produces unit vectors of the documented dimension", async () => {
    const [a] = await embeddings.embedDocuments(["dropout voltage 1.5 V"]);
    const b = await embeddings.embedQuery("dropout voltage 1.5 V");
    expect(a).toEqual(b);
    expect(a).toHaveLength(MOCK_EMBEDDING_DIMENSION);
    const norm = Math.sqrt(a!.reduce((s, v) => s + v * v, 0));
    expect(norm).toBeCloseTo(1, 10);
  });

  it("scores word-overlapping texts higher than disjoint ones", async () => {
    const query = await embeddings.embedQuery("LM317 dropout voltage");
    const [related, unrelated] = await embeddings.embedDocuments([
      "the LM317 has a dropout voltage of 1.5 V",
      "sourdough starter needs regular feeding",
    ]);
    expect(cosine(query, related!)).toBeGreaterThan(cosine(query, unrelated!));
  });

  it("is case-insensitive and returns a zero vector for empty text without NaN", async () => {
    const upper = await embeddings.embedQuery("DROPOUT VOLTAGE");
    const lower = await embeddings.embedQuery("dropout voltage");
    expect(upper).toEqual(lower);
    const empty = await embeddings.embedQuery("");
    expect(empty).toHaveLength(MOCK_EMBEDDING_DIMENSION);
    expect(empty.every((v) => v === 0)).toBe(true);
  });
});
