import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { syncCorpus } from "../knowledge/sync-corpus";
import { InMemoryVectorStore } from "../knowledge/in-memory-vector-store";
import { MockEmbeddings } from "../knowledge/mock-embeddings";

function tmp(files: Record<string, string>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sc-"));
  for (const [n, b] of Object.entries(files)) fs.writeFileSync(path.join(dir, n), b);
  return dir;
}

describe("syncCorpus", () => {
  it("chunks + embeds the corpus and upserts records into the store", async () => {
    const root = tmp({ "a.md": "# H\n\nalpha beta gamma", "b.md": "# G\n\ndelta" });
    const store = new InMemoryVectorStore({ topK: 10 });
    const res = await syncCorpus({ root, embeddings: new MockEmbeddings(), maxChunkChars: 1200, store });
    expect(res.upserted).toBeGreaterThan(0);
    const hits = await store.query(await new MockEmbeddings().embedQuery("alpha"));
    expect(hits[0]!.metadata).toMatchObject({ file: "a.md" });
    expect(hits[0]!.id).toMatch(/^a\.md:\d+$/);
  });

  it("is idempotent — re-running upserts the same ids, no duplicates", async () => {
    const root = tmp({ "a.md": "# H\n\nalpha" });
    const store = new InMemoryVectorStore({ topK: 10 });
    await syncCorpus({ root, embeddings: new MockEmbeddings(), maxChunkChars: 1200, store });
    await syncCorpus({ root, embeddings: new MockEmbeddings(), maxChunkChars: 1200, store });
    const hits = await store.query(await new MockEmbeddings().embedQuery("alpha"));
    expect(hits.filter((h) => h.id === "a.md:0")).toHaveLength(1);
  });

  it("returns { upserted: 0 } for a missing corpus dir", async () => {
    const store = new InMemoryVectorStore({ topK: 10 });
    const res = await syncCorpus({
      root: "/no/such/dir",
      embeddings: new MockEmbeddings(),
      maxChunkChars: 1200,
      store,
    });
    expect(res.upserted).toBe(0);
  });
});
