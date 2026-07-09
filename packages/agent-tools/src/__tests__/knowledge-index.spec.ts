import fs from "node:fs";
import path from "node:path";

import type { EmbeddingsInterface } from "@langchain/core/embeddings";

import { syncIndex } from "../knowledge/knowledge-index";
import { MockEmbeddings } from "../knowledge/mock-embeddings";
import { makeTmpDir, removeTmpDir, writeFile } from "./tmp-tree";

const embeddings = new MockEmbeddings();
const ARGS = { embeddings, maxChunkChars: 1200 };

/** A fake embedder exposing a `.model` property, like LangChain's OpenAIEmbeddings. */
class FakeModelEmbeddings implements EmbeddingsInterface {
  constructor(public model: string) {}
  async embedDocuments(docs: string[]): Promise<number[][]> {
    return docs.map(() => [1, 0]);
  }
  async embedQuery(): Promise<number[]> {
    return [1, 0];
  }
}

/**
 * Monkeypatches `embedDocuments` in place (preserving the instance's
 * constructor identity, unlike wrapping in a new plain object) and returns
 * the batches it was called with.
 */
function spyOnEmbedDocuments(target: EmbeddingsInterface): string[][] {
  const calls: string[][] = [];
  const original = target.embedDocuments.bind(target);
  target.embedDocuments = async (docs: string[]) => {
    calls.push(docs);
    return original(docs);
  };
  return calls;
}

describe("syncIndex", () => {
  let root: string;
  beforeEach(() => (root = makeTmpDir()));
  afterEach(() => removeTmpDir(root));

  const indexPath = () => path.join(root, ".knowledge", "index.json");

  it("builds the index from markdown files and persists it hidden", async () => {
    writeFile(root, "lm317.md", "## Specs\n\nDropout 1.5 V.");
    const { index, persistError } = await syncIndex({ root, ...ARGS });
    expect(persistError).toBeUndefined();
    expect(index.files["lm317.md"]!.chunks).toHaveLength(1);
    expect(index.files["lm317.md"]!.chunks[0]!.vector.length).toBeGreaterThan(0);
    expect(fs.existsSync(indexPath())).toBe(true);
  });

  it("re-embeds only changed files and drops deleted ones", async () => {
    writeFile(root, "a.md", "## A\n\nalpha");
    writeFile(root, "b.md", "## B\n\nbeta");
    const first = await syncIndex({ root, ...ARGS });
    const untouchedVector = first.index.files["b.md"]!.chunks[0]!.vector;

    const calls: string[][] = [];
    const spying = {
      embedDocuments: async (docs: string[]) => {
        calls.push(docs);
        return embeddings.embedDocuments(docs);
      },
      embedQuery: (q: string) => embeddings.embedQuery(q),
    };

    writeFile(root, "a.md", "## A\n\nalpha CHANGED");
    fs.rmSync(path.join(root, "b.md"));
    const second = await syncIndex({ root, embeddings: spying, maxChunkChars: 1200 });

    expect(second.index.files["b.md"]).toBeUndefined();
    expect(second.index.files["a.md"]!.chunks[0]!.text).toContain("CHANGED");
    // only a.md was re-embedded
    expect(calls.flat().join("\n")).toContain("CHANGED");
    expect(calls.flat().join("\n")).not.toContain("beta");
    void untouchedVector;
  });

  it("ignores non-md files, subdirectories, and the .knowledge dir itself", async () => {
    writeFile(root, "page.md", "## P\n\ncontent");
    writeFile(root, "notes.txt", "not markdown");
    writeFile(root, "sub/nested.md", "## N\n\nnested");
    await syncIndex({ root, ...ARGS });
    const again = await syncIndex({ root, ...ARGS });
    expect(Object.keys(again.index.files)).toEqual(["page.md"]);
  });

  it("rebuilds fully when the embedder fingerprint changes", async () => {
    writeFile(root, "a.md", "## A\n\nalpha");
    await syncIndex({ root, ...ARGS });
    const twoDim = {
      embedDocuments: async (docs: string[]) => docs.map(() => [1, 0]),
      embedQuery: async () => [1, 0],
    };
    const rebuilt = await syncIndex({
      root,
      embeddings: twoDim,
      maxChunkChars: 1200,
      expectedDimension: 2,
    });
    expect(rebuilt.index.files["a.md"]!.chunks[0]!.vector).toEqual([1, 0]);
  });

  it("rebuilds fully when only the embedder's model changes (same class)", async () => {
    writeFile(root, "a.md", "## A\n\nalpha");
    await syncIndex({
      root,
      embeddings: new FakeModelEmbeddings("model-a"),
      maxChunkChars: 1200,
    });

    const second = new FakeModelEmbeddings("model-b");
    const calls = spyOnEmbedDocuments(second);
    await syncIndex({ root, embeddings: second, maxChunkChars: 1200 });

    // a.md's content did not change, yet the model swap must force a re-embed.
    expect(calls.flat().join("\n")).toContain("alpha");
  });

  it("rebuilds fully when maxChunkChars changes", async () => {
    writeFile(root, "a.md", "## A\n\nalpha");
    await syncIndex({ root, ...ARGS });

    const second = new MockEmbeddings();
    const calls = spyOnEmbedDocuments(second);
    await syncIndex({ root, embeddings: second, maxChunkChars: 40 });

    expect(calls.flat().join("\n")).toContain("alpha");
  });

  it("rejects when the embedder returns fewer vectors than chunks, persisting nothing", async () => {
    writeFile(root, "a.md", "## A\n\nalpha\n\n## B\n\nbeta");
    const shortEmbeddings = {
      embedDocuments: async (docs: string[]) => embeddings.embedDocuments(docs.slice(1)),
      embedQuery: (q: string) => embeddings.embedQuery(q),
    };
    await expect(
      syncIndex({ root, embeddings: shortEmbeddings, maxChunkChars: 1200 }),
    ).rejects.toThrow(/vector/i);
    expect(fs.existsSync(indexPath())).toBe(false);
  });

  it("leaves the index file untouched on a no-op sync (dirty-flag skip)", async () => {
    writeFile(root, "a.md", "## A\n\nalpha");
    await syncIndex({ root, ...ARGS });
    const before = fs.readFileSync(indexPath());

    const writeSpy = jest.spyOn(fs, "writeFileSync");
    const renameSpy = jest.spyOn(fs, "renameSync");
    await syncIndex({ root, ...ARGS });
    expect(writeSpy).not.toHaveBeenCalled();
    expect(renameSpy).not.toHaveBeenCalled();
    writeSpy.mockRestore();
    renameSpy.mockRestore();

    const after = fs.readFileSync(indexPath());
    expect(after).toEqual(before);
  });

  it("creates nothing on disk when syncing a missing root with no prior index", async () => {
    const missing = path.join(root, "nope");
    await syncIndex({ root: missing, ...ARGS });
    expect(fs.existsSync(path.join(missing, ".knowledge"))).toBe(false);
    expect(fs.existsSync(missing)).toBe(false);
  });

  it("treats a corrupt index file as absent and rebuilds without error", async () => {
    writeFile(root, "a.md", "## A\n\nalpha");
    await syncIndex({ root, ...ARGS });
    fs.writeFileSync(path.join(root, ".knowledge", "index.json"), "{not json!!");
    const rebuilt = await syncIndex({ root, ...ARGS });
    expect(rebuilt.index.files["a.md"]!.chunks).toHaveLength(1);
  });

  it("returns an empty index for an empty or missing corpus dir", async () => {
    const { index } = await syncIndex({ root, ...ARGS });
    expect(index.files).toEqual({});
    const missing = path.join(root, "nope");
    const result = await syncIndex({ root: missing, ...ARGS });
    expect(result.index.files).toEqual({});
  });
});
