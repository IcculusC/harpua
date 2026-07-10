import { ingest } from "../knowledge/ingest";
import { InMemoryVectorStore } from "../knowledge/in-memory-vector-store";
import { MockEmbeddings } from "../knowledge/mock-embeddings";

const embeddings = new MockEmbeddings();

async function embed1(q: string): Promise<number[]> {
  return embeddings.embedQuery(q);
}

describe("ingest", () => {
  it("chunks, embeds, and upserts documents with explicit ids", async () => {
    const store = new InMemoryVectorStore();
    const result = await ingest(
      [
        { id: "doc-a", text: "# Title\n\nAlpha body paragraph.", metadata: { src: "a" } },
        { id: "doc-b", text: "# Other\n\nBeta body paragraph." },
      ],
      { embeddings, store },
    );

    expect(result.upserted).toBeGreaterThanOrEqual(2);
    const matches = await store.query(await embed1("Alpha"), { topK: 10 });
    const ids = matches.map((m) => m.id);
    expect(ids.some((id) => id.startsWith("doc-a:"))).toBe(true);
    expect(ids.some((id) => id.startsWith("doc-b:"))).toBe(true);
    const a = matches.find((m) => m.id.startsWith("doc-a:"))!;
    expect(a.metadata).toMatchObject({ src: "a" });
    expect(a.metadata).toHaveProperty("startLine");
    expect(a.metadata).toHaveProperty("headingTrail");
  });

  it("derives a content-hash id when a document has none, deduping identical text", async () => {
    const store = new InMemoryVectorStore();
    const doc = { text: "# H\n\nSame exact excerpt text." };
    const first = await ingest([doc], { embeddings, store });
    const afterFirst = (await store.query(await embed1("excerpt"), { topK: 50 })).length;
    await ingest([{ text: "# H\n\nSame exact excerpt text." }], { embeddings, store });
    const afterSecond = (await store.query(await embed1("excerpt"), { topK: 50 })).length;
    expect(afterSecond).toBe(afterFirst);
    expect(first.upserted).toBeGreaterThan(0);
  });

  it("lets chunk provenance win over a colliding document metadata key", async () => {
    const store = new InMemoryVectorStore();
    await ingest(
      [{ id: "d", text: "# H\n\nBody line here.", metadata: { startLine: 999 } }],
      { embeddings, store },
    );
    const [m] = await store.query(await embed1("Body"), { topK: 1 });
    expect(m!.metadata!.startLine).not.toBe(999);
  });

  it("handles empty inputs without upserting", async () => {
    const store = new InMemoryVectorStore();
    const upsertSpy = jest.spyOn(store, "upsert");
    expect(await ingest([], { embeddings, store })).toEqual({ upserted: 0 });
    expect(await ingest([{ text: "   \n  \n" }], { embeddings, store })).toEqual({ upserted: 0 });
    expect(upsertSpy).not.toHaveBeenCalled();
  });

  it("honors maxChunkChars: a smaller cap yields more chunks", async () => {
    const text = "# H\n\n" + Array.from({ length: 40 }, (_, i) => `Line ${i} of body.`).join("\n");
    const big = new InMemoryVectorStore();
    const small = new InMemoryVectorStore();
    const bigRes = await ingest([{ id: "x", text }], { embeddings, store: big });
    const smallRes = await ingest([{ id: "x", text }], { embeddings, store: small, maxChunkChars: 40 });
    expect(smallRes.upserted).toBeGreaterThan(bigRes.upserted);
  });

  it("rejects a malformed document at the boundary (zod)", async () => {
    const store = new InMemoryVectorStore();
    const upsertSpy = jest.spyOn(store, "upsert");
    await expect(
      ingest([{ text: 123 as unknown as string }], { embeddings, store }),
    ).rejects.toThrow();
    expect(upsertSpy).not.toHaveBeenCalled();
  });

  it("rejects options with a store that isn't a VectorStore (zod)", async () => {
    await expect(
      ingest([{ text: "hi there" }], { embeddings, store: {} as unknown as InMemoryVectorStore }),
    ).rejects.toThrow();
  });
});

describe("ingest shrink-correctness", () => {
  it("clears the orphaned tail when an explicit-id doc is re-ingested smaller", async () => {
    const store = new InMemoryVectorStore({ topK: 100 });
    const long = "# H\n\n" + Array.from({ length: 30 }, (_, i) => `Para ${i} body text here.`).join("\n\n");
    await ingest([{ id: "power.md", text: long }], { embeddings, store, maxChunkChars: 40 });
    const before = (await store.query(await embeddings.embedQuery("body"), { topK: 100 })).length;
    expect(before).toBeGreaterThan(1);

    const short = "# H\n\nPara 0 body text here.";
    const res = await ingest([{ id: "power.md", text: short }], { embeddings, store, maxChunkChars: 40 });
    const ids = (await store.query(await embeddings.embedQuery("body"), { topK: 100 })).map((m) => m.id);
    expect(ids.every((id) => id.startsWith("power.md:"))).toBe(true);
    expect(ids.length).toBe(res.upserted);
    expect(ids.length).toBeLessThan(before);
  });

  it("does NOT clear prior records for id-less (content-hash) docs", async () => {
    const store = new InMemoryVectorStore({ topK: 100 });
    await ingest([{ text: "# H\n\nFirst immutable excerpt." }], { embeddings, store });
    const afterFirst = (await store.query(await embeddings.embedQuery("excerpt"), { topK: 100 })).length;
    await ingest([{ text: "# H\n\nSecond different excerpt entirely." }], { embeddings, store });
    const afterSecond = (await store.query(await embeddings.embedQuery("excerpt"), { topK: 100 })).length;
    expect(afterSecond).toBeGreaterThan(afterFirst); // first survives — immutable-append
  });

  it("clears an explicit-id doc's records when re-ingested empty", async () => {
    const store = new InMemoryVectorStore({ topK: 100 });
    await ingest([{ id: "notes.md", text: "# H\n\nSome content to index." }], { embeddings, store });
    expect((await store.query(await embeddings.embedQuery("content"), { topK: 100 })).length).toBeGreaterThan(0);
    const res = await ingest([{ id: "notes.md", text: "   \n  \n" }], { embeddings, store });
    expect(res.upserted).toBe(0);
    const survivors = (await store.query(await embeddings.embedQuery("content"), { topK: 100 })).filter((m) =>
      m.id.startsWith("notes.md:"),
    );
    expect(survivors).toHaveLength(0);
  });
});
