import { searchKnowledgeTool } from "../knowledge/search-knowledge";
import { rememberTool } from "../knowledge/remember";
import { InMemoryVectorStore } from "../knowledge/in-memory-vector-store";
import { MockEmbeddings } from "../knowledge/mock-embeddings";

const embeddings = new MockEmbeddings();

describe("search_knowledge provenance rendering", () => {
  it("renders web provenance from source/title when there is no file", async () => {
    const store = new InMemoryVectorStore({ topK: 10 });
    const v = await embeddings.embedDocuments(["alpha", "beta", "gamma", "delta"]);
    await store.upsert([
      { id: "r1", vector: v[0]!, text: "alpha", metadata: { title: "T1", source: "https://s1" } },
      { id: "r2", vector: v[1]!, text: "beta", metadata: { source: "https://s2" } },
      { id: "r3", vector: v[2]!, text: "gamma", metadata: { title: "T3" } },
      { id: "r4", vector: v[3]!, text: "delta", metadata: {} },
    ]);
    const search = searchKnowledgeTool({ root: "/unused", embeddings, store });
    const out = (await search.invoke({ query: "alpha beta gamma delta" })) as string;

    expect(out).toContain("1. T1 (https://s1) (score"); // title + source, then score suffix — no id leak/dup
    expect(out).toContain("2. https://s2 (score"); // source only
    expect(out).toContain("3. T3 (score"); // title only
    expect(out).toContain("4. r4 (score"); // neither → id fallback
  });

  it("round-trips: a remembered excerpt is found and rendered as title (source)", async () => {
    const store = new InMemoryVectorStore({ topK: 5 });
    await rememberTool({ embeddings, store }).invoke({
      text: "The dropout voltage is 200 mV at 1 A.",
      source: "https://example.com/ds",
      title: "dropout at 1A",
    });
    const search = searchKnowledgeTool({ root: "/unused", embeddings, store });
    const out = (await search.invoke({ query: "what is the dropout voltage?" })) as string;
    expect(out).toContain("dropout at 1A (https://example.com/ds)");
  });
});
