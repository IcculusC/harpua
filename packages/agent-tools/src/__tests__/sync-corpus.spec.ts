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

  it("clears orphaned chunks when a corpus file is trimmed down and re-synced", async () => {
    const emb = new MockEmbeddings();
    const store = new InMemoryVectorStore({ topK: 100 });
    const long = "# H\n\n" + Array.from({ length: 30 }, (_, i) => `Para ${i} body text here.`).join("\n\n");
    const root = tmp({ "power.md": long });
    await syncCorpus({ root, embeddings: emb, maxChunkChars: 40, store });
    const before = (await store.query(await emb.embedQuery("body"), { topK: 100 })).length;
    expect(before).toBeGreaterThan(1);

    fs.writeFileSync(path.join(root, "power.md"), "# H\n\nPara 0 body text here.");
    const res = await syncCorpus({ root, embeddings: emb, maxChunkChars: 40, store });
    const ids = (await store.query(await emb.embedQuery("body"), { topK: 100 })).map((m) => m.id);
    expect(ids.length).toBe(res.upserted);
    expect(ids.length).toBeLessThan(before);
  });
});
