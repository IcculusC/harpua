import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { searchKnowledgeTool } from "../knowledge/search-knowledge";
import { InMemoryVectorStore } from "../knowledge/in-memory-vector-store";
import { MockEmbeddings } from "../knowledge/mock-embeddings";

describe("searchKnowledgeTool + store option", () => {
  it("routes through a provided store and formats its matches (file:line + score)", async () => {
    const emb = new MockEmbeddings();
    const store = new InMemoryVectorStore({ topK: 5 });
    await store.upsert([
      {
        id: "a.md:0",
        vector: await emb.embedQuery("dropout voltage 200 mV"),
        text: "The dropout voltage is 200 mV at 1 A.",
        metadata: { file: "a.md", startLine: 3, endLine: 3, headingTrail: ["Dropout"] },
      },
    ]);
    const tool = searchKnowledgeTool({ root: "/unused-when-store-given", embeddings: emb, store });
    const out = (await tool.invoke({ query: "what is the dropout voltage?" })) as string;
    expect(out).toContain("a.md:3-3");
    expect(out).toContain("Dropout");
    expect(out).toMatch(/score \d\.\d\d/);
  });

  it("defaults to the built-in corpus retrieval when no store is given", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "sk-"));
    const tool = searchKnowledgeTool({ root, embeddings: new MockEmbeddings() });
    const out = (await tool.invoke({ query: "anything" })) as string;
    expect(out).toContain("nothing indexed");
  });
});
