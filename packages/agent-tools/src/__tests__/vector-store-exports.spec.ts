import * as pkg from "../index";

describe("public exports (vector store)", () => {
  it("exports the BYO store surface", () => {
    for (const n of ["InMemoryVectorStore", "syncCorpus"]) {
      expect((pkg as Record<string, unknown>)[n]).toBeDefined();
    }
  });

  it("does NOT leak the built-in corpus path as a public store", () => {
    expect((pkg as Record<string, unknown>).OnDiskVectorStore).toBeUndefined();
    expect((pkg as Record<string, unknown>).queryCorpus).toBeUndefined();
  });
});
