import * as pkg from "../index";

describe("public exports (prepareChunks)", () => {
  it("exports prepareChunks as a function", () => {
    expect(typeof (pkg as Record<string, unknown>).prepareChunks).toBe("function");
  });

  it("does NOT leak the internal already-resolved-options entry point", () => {
    expect((pkg as Record<string, unknown>).prepareChunksFromResolvedOptions).toBeUndefined();
  });
});
