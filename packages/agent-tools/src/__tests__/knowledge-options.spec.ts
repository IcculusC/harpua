import {
  resolveSearchKnowledgeOptions,
  DEFAULT_TOP_K,
  DEFAULT_MAX_CHUNK_CHARS,
} from "../knowledge/options";
import { MockEmbeddings } from "../knowledge/mock-embeddings";

describe("search_knowledge options", () => {
  it("applies defaults with only root given, including a MockEmbeddings instance", () => {
    const opts = resolveSearchKnowledgeOptions({ root: "/tmp/corpus" });
    expect(opts.topK).toBe(DEFAULT_TOP_K);
    expect(opts.maxChunkChars).toBe(DEFAULT_MAX_CHUNK_CHARS);
    expect(opts.minScore).toBeUndefined();
    expect(opts.embeddings).toBeInstanceOf(MockEmbeddings);
  });

  it("accepts root as a function and passes a custom embeddings object through", () => {
    const resolver = () => "/tmp/other";
    const custom = {
      embedDocuments: async (docs: string[]) => docs.map(() => [1, 0]),
      embedQuery: async () => [1, 0],
    };
    const opts = resolveSearchKnowledgeOptions({ root: resolver, embeddings: custom });
    expect(opts.root).toBe(resolver);
    expect(opts.embeddings).toBe(custom);
  });

  it("rejects topK over the ceiling, unknown keys, and non-embeddings objects", () => {
    expect(() =>
      resolveSearchKnowledgeOptions({ root: "/x", topK: 21 }),
    ).toThrow();
    expect(() =>
      resolveSearchKnowledgeOptions({ root: "/x", nope: 1 } as never),
    ).toThrow();
    expect(() =>
      resolveSearchKnowledgeOptions({ root: "/x", embeddings: {} } as never),
    ).toThrow();
  });
});
