import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { queryCorpus } from "../knowledge/corpus-query";
import { MockEmbeddings } from "../knowledge/mock-embeddings";

function tmpCorpus(files: Record<string, string>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cq-"));
  for (const [name, body] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), body);
  return dir;
}

describe("queryCorpus", () => {
  it("indexes the corpus and returns scored matches with provenance metadata", async () => {
    const root = tmpCorpus({ "a.md": "# Dropout\n\nThe dropout voltage is 200 mV at 1 A." });
    const emb = new MockEmbeddings();
    const hits = await queryCorpus(
      { root, embeddings: emb, maxChunkChars: 1200 },
      await emb.embedQuery("dropout voltage"),
      { topK: 5 },
    );
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0]!.metadata).toMatchObject({ file: "a.md" });
    expect(typeof (hits[0]!.metadata as { startLine?: number }).startLine).toBe("number");
    expect(hits[0]!.id).toMatch(/^a\.md:\d+$/);
    expect(fs.existsSync(path.join(root, ".knowledge", "index.json"))).toBe(true);
  });

  it("honors topK and minScore", async () => {
    const root = tmpCorpus({ "a.md": "# A\n\nalpha\n\n# B\n\nbeta\n\n# C\n\ngamma" });
    const emb = new MockEmbeddings();
    const q = await emb.embedQuery("alpha beta gamma");
    expect(await queryCorpus({ root, embeddings: emb, maxChunkChars: 40 }, q, { topK: 1 })).toHaveLength(1);
    expect((await queryCorpus({ root, embeddings: emb, maxChunkChars: 40 }, q, { topK: 3 })).length).toBeGreaterThan(1);
    const high = await queryCorpus({ root, embeddings: emb, maxChunkChars: 40 }, q, { topK: 5, minScore: 2 });
    expect(high).toHaveLength(0); // nothing scores >= 2 (cosine ≤ 1)
  });

  it("returns [] for an empty/missing corpus (no throw)", async () => {
    const root = tmpCorpus({});
    const emb = new MockEmbeddings();
    expect(
      await queryCorpus({ root, embeddings: emb, maxChunkChars: 1200 }, await emb.embedQuery("x")),
    ).toEqual([]);
  });
});
