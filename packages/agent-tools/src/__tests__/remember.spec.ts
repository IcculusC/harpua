import { rememberTool } from "../knowledge/remember";
import { InMemoryVectorStore } from "../knowledge/in-memory-vector-store";
import { MockEmbeddings } from "../knowledge/mock-embeddings";

const embeddings = new MockEmbeddings();

describe("rememberTool", () => {
  it("throws at construction when no store is given", () => {
    expect(() => rememberTool({} as never)).toThrow();
  });

  it("writes an excerpt with source+title metadata, retrievable from the store", async () => {
    const store = new InMemoryVectorStore();
    const tool = rememberTool({ embeddings, store });
    const out = (await tool.invoke({
      text: "# Dropout\n\nThe dropout voltage is 200 mV at 1 A.",
      source: "https://example.com/ds",
      title: "dropout at 1A",
    })) as string;
    expect(out).toContain("remembered:");
    expect(out).toContain("searchable via search_knowledge");

    const [m] = await store.query(await embeddings.embedQuery("dropout voltage"), { topK: 1 });
    expect(m!.metadata).toMatchObject({ source: "https://example.com/ds", title: "dropout at 1A" });
  });

  it("omits source/title metadata keys when not provided", async () => {
    const store = new InMemoryVectorStore();
    const tool = rememberTool({ embeddings, store });
    await tool.invoke({ text: "# H\n\nA bare note with no provenance." });
    const [m] = await store.query(await embeddings.embedQuery("bare note"), { topK: 1 });
    expect(m!.metadata).not.toHaveProperty("source");
    expect(m!.metadata).not.toHaveProperty("title");
  });

  it("is idempotent for identical text (content-hash id)", async () => {
    const store = new InMemoryVectorStore();
    const tool = rememberTool({ embeddings, store });
    await tool.invoke({ text: "# H\n\nSame exact excerpt." });
    const afterFirst = (await store.query(await embeddings.embedQuery("excerpt"), { topK: 50 })).length;
    await tool.invoke({ text: "# H\n\nSame exact excerpt." });
    const afterSecond = (await store.query(await embeddings.embedQuery("excerpt"), { topK: 50 })).length;
    expect(afterSecond).toBe(afterFirst);
  });

  it("returns 'nothing to save' for whitespace-only text (no upsert)", async () => {
    const store = new InMemoryVectorStore();
    const upsertSpy = jest.spyOn(store, "upsert");
    const tool = rememberTool({ embeddings, store });
    const out = (await tool.invoke({ text: "   \n  \n" })) as string;
    expect(out).toContain("nothing to save");
    expect(upsertSpy).not.toHaveBeenCalled();
  });

  it("returns an error string (never throws) when the embedder fails", async () => {
    const throwing = {
      embedDocuments: async () => {
        throw new Error("boom");
      },
      embedQuery: async () => {
        throw new Error("boom");
      },
    };
    const tool = rememberTool({ embeddings: throwing as never, store: new InMemoryVectorStore() });
    const out = (await tool.invoke({ text: "hello world excerpt" })) as string;
    expect(out).toContain("could not save");
    expect(out).toContain("boom");
  });
});
