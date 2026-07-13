import type { EmbeddingsInterface } from "@langchain/core/embeddings";

import { ingest, type IngestOptions } from "../knowledge/ingest";
import { MockEmbeddings } from "../knowledge/mock-embeddings";
import type { VectorMatch, VectorRecord, VectorStore } from "../knowledge/vector-store";

/** MockEmbeddings that records every embedDocuments batch it receives. */
class RecordingEmbeddings implements EmbeddingsInterface {
  readonly batches: string[][] = [];
  private readonly inner = new MockEmbeddings();

  async embedDocuments(documents: string[]): Promise<number[][]> {
    this.batches.push([...documents]);
    return this.inner.embedDocuments(documents);
  }

  async embedQuery(document: string): Promise<number[]> {
    return this.inner.embedQuery(document);
  }

  get texts(): string[] {
    return this.batches.flat();
  }
}

/** VectorStore fake that captures upserted records and per-call batch sizes. */
class CaptureStore implements VectorStore {
  records: VectorRecord[] = [];
  readonly upsertBatches: number[] = [];

  async upsert(records: VectorRecord[]): Promise<void> {
    this.upsertBatches.push(records.length);
    this.records.push(...records);
  }

  async query(): Promise<VectorMatch[]> {
    return [];
  }

  async deleteByDocumentKey(documentKey: string): Promise<void> {
    this.records = this.records.filter((r) => r.documentKey !== documentKey);
  }
}

/** Three h1 sections → three chunks: a "---" stub, a sparse table row (10
 *  alphanumeric chars), and real prose. */
const THREE_SECTIONS =
  "# Alpha\n\n---\n\n# Beta\n\n| 200-400mA | 5V |\n\n# Gamma\n\nReal prose about power budgets.";

/** A doc whose chunks number `count`, one per h2 section. */
function manyChunksDoc(count: number): string {
  return Array.from({ length: count }, (_, i) => `## S${i}\n\nBody ${i} unique.`).join("\n\n");
}

describe("ingest defaults pin today's behavior", () => {
  it("keeps zero-alnum chunks by default (no junk floor)", async () => {
    const store = new CaptureStore();
    await ingest([{ id: "d", text: THREE_SECTIONS }], {
      embeddings: new RecordingEmbeddings(),
      store,
    });
    expect(store.records.map((r) => r.text)).toEqual([
      "---",
      "| 200-400mA | 5V |",
      "Real prose about power budgets.",
    ]);
  });

  it("embeds heading trail + body joined by newlines by default (legacy embeddingTextFor)", async () => {
    const embeddings = new RecordingEmbeddings();
    const store = new CaptureStore();
    await ingest([{ id: "d", text: "# Guide\n\n## Setup\n\nInstall the package." }], {
      embeddings,
      store,
    });
    expect(embeddings.texts).toEqual(["Guide\nSetup\nInstall the package."]);
    expect(store.records.map((r) => r.text)).toEqual(["Install the package."]);
  });

  it("makes one embed call and one upsert call for a small ingest", async () => {
    const embeddings = new RecordingEmbeddings();
    const store = new CaptureStore();
    await ingest([{ id: "d", text: THREE_SECTIONS }], { embeddings, store });
    expect(embeddings.batches).toHaveLength(1);
    expect(store.upsertBatches).toEqual([3]);
  });
});

describe("ingest metadata.chunkIndex", () => {
  it("stamps a sequential chunkIndex per document starting at 0", async () => {
    const store = new CaptureStore();
    await ingest([{ id: "d", text: THREE_SECTIONS }], {
      embeddings: new MockEmbeddings(),
      store,
    });
    expect(store.records.map((r) => r.metadata?.chunkIndex)).toEqual([0, 1, 2]);
  });

  it("restarts chunkIndex for each document", async () => {
    const store = new CaptureStore();
    await ingest(
      [
        { id: "a", text: "# A\n\nFirst body.\n\n# B\n\nSecond body." },
        { id: "b", text: "# C\n\nThird body." },
      ],
      { embeddings: new MockEmbeddings(), store },
    );
    const byDoc = (key: string): unknown[] =>
      store.records.filter((r) => r.documentKey === key).map((r) => r.metadata?.chunkIndex);
    expect(byDoc("a")).toEqual([0, 1]);
    expect(byDoc("b")).toEqual([0]);
  });
});

describe("ingest minAlnumChars", () => {
  it("keeps the sparse table row at floor 8 and drops the separator stub", async () => {
    const store = new CaptureStore();
    await ingest([{ id: "d", text: THREE_SECTIONS }], {
      embeddings: new MockEmbeddings(),
      store,
      minAlnumChars: 8,
    });
    expect(store.records.map((r) => r.text)).toEqual([
      "| 200-400mA | 5V |",
      "Real prose about power budgets.",
    ]);
  });

  it("keeps chunkIndex (and record ids) dense after junk chunks are dropped", async () => {
    const store = new CaptureStore();
    await ingest([{ id: "d", text: THREE_SECTIONS }], {
      embeddings: new MockEmbeddings(),
      store,
      minAlnumChars: 8,
    });
    expect(store.records.map((r) => r.metadata?.chunkIndex)).toEqual([0, 1]);
    expect(store.records.map((r) => r.id)).toEqual(["d:0", "d:1"]);
  });

  it("never embeds dropped chunks", async () => {
    const embeddings = new RecordingEmbeddings();
    await ingest([{ id: "d", text: THREE_SECTIONS }], {
      embeddings,
      store: new CaptureStore(),
      minAlnumChars: 8,
    });
    expect(embeddings.texts).toHaveLength(2);
    expect(embeddings.texts.some((t) => t.endsWith("---"))).toBe(false);
  });

  it("rejects a negative or fractional floor at call time", async () => {
    const opts = { embeddings: new MockEmbeddings(), store: new CaptureStore() };
    await expect(
      ingest([{ text: "hi" }], { ...opts, minAlnumChars: -1 } as unknown as IngestOptions),
    ).rejects.toThrow();
    await expect(
      ingest([{ text: "hi" }], { ...opts, minAlnumChars: 1.5 } as unknown as IngestOptions),
    ).rejects.toThrow();
  });
});

describe("ingest sanitize", () => {
  it("default strips C0/C1 control chars but keeps tabs and newlines", async () => {
    const embeddings = new RecordingEmbeddings();
    const store = new CaptureStore();
    await ingest(
      [{ id: "d", text: "# H\n\ncol1\tcol2\u0001\u000E\u009Cdirty\nsecond line" }],
      { embeddings, store },
    );
    expect(store.records.map((r) => r.text)).toEqual(["col1\tcol2dirty\nsecond line"]);
    // The embedder sees sanitized text too.
    expect(embeddings.texts).toEqual(["H\ncol1\tcol2dirty\nsecond line"]);
  });

  it("applies sanitize before the junk floor (the floor counts sanitized text)", async () => {
    const store = new CaptureStore();
    await ingest([{ id: "d", text: THREE_SECTIONS }], {
      embeddings: new MockEmbeddings(),
      store,
      minAlnumChars: 8,
      // Deleting digits drops the table row ("| -mA | V |" → 3 alnum) but not the prose.
      sanitize: (text: string) => text.replace(/\d/g, ""),
    });
    expect(store.records.map((r) => r.text)).toEqual(["Real prose about power budgets."]);
  });

  it("stores and embeds a custom sanitizer's output", async () => {
    const embeddings = new RecordingEmbeddings();
    const store = new CaptureStore();
    await ingest([{ id: "d", text: "# H\n\nquiet body." }], {
      embeddings,
      store,
      sanitize: (text: string) => text.toUpperCase(),
    });
    expect(store.records.map((r) => r.text)).toEqual(["QUIET BODY."]);
    expect(embeddings.texts).toEqual(["H\nQUIET BODY."]);
  });

  it("rejects a non-function sanitize at call time", async () => {
    await expect(
      ingest([{ text: "hi" }], {
        embeddings: new MockEmbeddings(),
        store: new CaptureStore(),
        sanitize: 5,
      } as unknown as IngestOptions),
    ).rejects.toThrow();
  });
});

describe("ingest embedHeadingTrail", () => {
  it("embeds '<trail joined with \" > \">: <text>' while storing the raw chunk text", async () => {
    const embeddings = new RecordingEmbeddings();
    const store = new CaptureStore();
    await ingest([{ id: "d", text: "# Guide\n\n## Setup\n\nInstall the package." }], {
      embeddings,
      store,
      embedHeadingTrail: true,
    });
    expect(embeddings.texts).toEqual(["Guide > Setup: Install the package."]);
    expect(store.records.map((r) => r.text)).toEqual(["Install the package."]);
    expect(embeddings.texts[0]).not.toBe(store.records[0]!.text);
  });

  it("embeds the raw text when a chunk has no heading trail", async () => {
    const embeddings = new RecordingEmbeddings();
    await ingest([{ id: "d", text: "Just plain text with no headings." }], {
      embeddings,
      store: new CaptureStore(),
      embedHeadingTrail: true,
    });
    expect(embeddings.texts).toEqual(["Just plain text with no headings."]);
  });

  it("rejects a non-boolean at call time", async () => {
    await expect(
      ingest([{ text: "hi" }], {
        embeddings: new MockEmbeddings(),
        store: new CaptureStore(),
        embedHeadingTrail: "yes",
      } as unknown as IngestOptions),
    ).rejects.toThrow();
  });
});

describe("ingest batchSize", () => {
  it("batches embedDocuments and upsert calls: 150 chunks at 64 → 64/64/22", async () => {
    const embeddings = new RecordingEmbeddings();
    const store = new CaptureStore();
    await ingest([{ id: "big", text: manyChunksDoc(150) }], {
      embeddings,
      store,
      batchSize: 64,
    });
    expect(embeddings.batches.map((b) => b.length)).toEqual([64, 64, 22]);
    expect(store.upsertBatches).toEqual([64, 64, 22]);
  });

  it("defaults to 64", async () => {
    const embeddings = new RecordingEmbeddings();
    const store = new CaptureStore();
    await ingest([{ id: "big", text: manyChunksDoc(150) }], { embeddings, store });
    expect(embeddings.batches.map((b) => b.length)).toEqual([64, 64, 22]);
    expect(store.upsertBatches).toEqual([64, 64, 22]);
  });

  it("embeds per document but batches upserts across documents", async () => {
    const embeddings = new RecordingEmbeddings();
    const store = new CaptureStore();
    await ingest(
      [
        { id: "a", text: manyChunksDoc(3) },
        { id: "b", text: manyChunksDoc(3) },
      ],
      { embeddings, store, batchSize: 4 },
    );
    expect(embeddings.batches.map((b) => b.length)).toEqual([3, 3]);
    expect(store.upsertBatches).toEqual([4, 2]);
  });

  it("rejects zero, negative, and fractional batch sizes at call time", async () => {
    const opts = { embeddings: new MockEmbeddings(), store: new CaptureStore() };
    for (const batchSize of [0, -2, 1.5]) {
      await expect(
        ingest([{ text: "hi" }], { ...opts, batchSize } as unknown as IngestOptions),
      ).rejects.toThrow();
    }
  });
});

describe("ingest option surface", () => {
  it("rejects unknown option keys at call time", async () => {
    await expect(
      ingest([{ text: "hi" }], {
        embeddings: new MockEmbeddings(),
        store: new CaptureStore(),
        batchsize: 10, // typo'd key must not be silently ignored
      } as unknown as IngestOptions),
    ).rejects.toThrow();
  });
});
