import { searchKnowledgeTool } from "../knowledge/search-knowledge";
import { rememberTool } from "../knowledge/remember";
import { InMemoryVectorStore } from "../knowledge/in-memory-vector-store";
import { MockEmbeddings } from "../knowledge/mock-embeddings";

const failingEmbeddings = {
  embedDocuments: async () => {
    throw new Error("boom");
  },
  embedQuery: async () => {
    throw new Error("boom");
  },
};

describe("searchKnowledgeTool name/description overrides", () => {
  it("defaults stay search_knowledge with the stock description", () => {
    const t = searchKnowledgeTool({ root: "/tmp", embeddings: new MockEmbeddings() });
    expect(t.name).toBe("search_knowledge");
    expect(t.description).toContain("sources");
  });

  it("overrides land on the tool, so two backends mount side by side", () => {
    const embeddings = new MockEmbeddings();
    const corpus = searchKnowledgeTool({ root: "/tmp", embeddings });
    const memory = searchKnowledgeTool({
      store: new InMemoryVectorStore({ topK: 5 }),
      embeddings,
      name: "search_memory",
      description: "Search excerpts you previously chose to remember.",
    });
    expect(corpus.name).toBe("search_knowledge");
    expect(memory.name).toBe("search_memory");
    expect(memory.description).toBe("Search excerpts you previously chose to remember.");
  });

  it("a renamed instance's failure messages carry its own name", async () => {
    const t = searchKnowledgeTool({
      store: new InMemoryVectorStore({ topK: 5 }),
      embeddings: failingEmbeddings,
      name: "search_memory",
    });
    const out = (await t.invoke({ query: "q" })) as string;
    expect(out).toMatch(/^search_memory:/);
    expect(out).not.toContain("search_knowledge");
  });

  it("an empty STORE says 'nothing stored yet' and never recommends fetch_url", async () => {
    const t = searchKnowledgeTool({
      store: new InMemoryVectorStore({ topK: 5 }),
      embeddings: new MockEmbeddings(),
      name: "search_memory",
    });
    const out = (await t.invoke({ query: "q" })) as string;
    expect(out).toMatch(/^search_memory: nothing stored yet/);
    expect(out).not.toContain("fetch_url");
  });

  it("a store-backed instance boots without root", async () => {
    const emb = new MockEmbeddings();
    const store = new InMemoryVectorStore({ topK: 5 });
    await store.upsert([
      {
        id: "m1",
        vector: await emb.embedQuery("the capital of France is Paris"),
        text: "The capital of France is Paris.",
        metadata: { title: "capitals", source: "notes" },
      },
    ]);
    const t = searchKnowledgeTool({ store, embeddings: emb, name: "search_memory" });
    const out = (await t.invoke({ query: "capital of France" })) as string;
    expect(out).toContain("Paris");
  });

  it("no root AND no store throws at construction", () => {
    expect(() => searchKnowledgeTool({ embeddings: new MockEmbeddings() })).toThrow(/root/);
  });

  it("rejects a tool name with a provider-illegal charset", () => {
    expect(() =>
      searchKnowledgeTool({ root: "/tmp", embeddings: new MockEmbeddings(), name: "search memory!" }),
    ).toThrow();
  });
});

describe("rememberTool searchToolName", () => {
  it("defaults to pointing at search_knowledge", async () => {
    const t = rememberTool({ store: new InMemoryVectorStore({ topK: 5 }) });
    expect(t.description).toContain("search_knowledge");
    const out = (await t.invoke({ text: "keep this", title: "note" })) as string;
    expect(out).toContain("search_knowledge");
  });

  it("points its description and success message at the named reader", async () => {
    const t = rememberTool({
      store: new InMemoryVectorStore({ topK: 5 }),
      searchToolName: "search_memory",
    });
    expect(t.description).toContain("search_memory");
    expect(t.description).not.toContain("search_knowledge");
    const out = (await t.invoke({ text: "keep this", title: "note" })) as string;
    expect(out).toContain("search_memory");
    expect(out).not.toContain("search_knowledge");
  });

  it("rejects a provider-illegal searchToolName", () => {
    expect(() =>
      rememberTool({ store: new InMemoryVectorStore({ topK: 5 }), searchToolName: "no spaces" }),
    ).toThrow();
  });
});
