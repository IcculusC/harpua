import { prepareChunks, type PrepareChunksOptions } from "../knowledge/prepare-chunks";

/** Three h1 sections → three chunks: a "---" stub, a sparse table row (10
 *  alphanumeric chars), and real prose. Mirrors ingest-chunking.spec.ts's
 *  fixture so both paths are pinned against the same behavior. */
const THREE_SECTIONS =
  "# Alpha\n\n---\n\n# Beta\n\n| 200-400mA | 5V |\n\n# Gamma\n\nReal prose about power budgets.";

describe("prepareChunks defaults", () => {
  it("chunks markdown into text/startLine/endLine/headingTrail, dense chunkIndex from 0", () => {
    const chunks = prepareChunks(THREE_SECTIONS);
    expect(chunks.map((c) => c.text)).toEqual([
      "---",
      "| 200-400mA | 5V |",
      "Real prose about power budgets.",
    ]);
    expect(chunks.map((c) => c.chunkIndex)).toEqual([0, 1, 2]);
    expect(chunks.map((c) => c.headingTrail)).toEqual([["Alpha"], ["Beta"], ["Gamma"]]);
    expect(chunks.every((c) => typeof c.startLine === "number" && typeof c.endLine === "number")).toBe(
      true,
    );
  });

  it("embeds heading trail + body joined by newlines by default (legacy embeddingTextFor)", () => {
    const [chunk] = prepareChunks("# Guide\n\n## Setup\n\nInstall the package.");
    expect(chunk!.embedText).toBe("Guide\nSetup\nInstall the package.");
    expect(chunk!.text).toBe("Install the package.");
  });

  it("honors maxChunkChars: a smaller cap yields more chunks", () => {
    const text = "# H\n\n" + Array.from({ length: 40 }, (_, i) => `Line ${i} of body.`).join("\n");
    const big = prepareChunks(text);
    const small = prepareChunks(text, { maxChunkChars: 40 });
    expect(small.length).toBeGreaterThan(big.length);
  });

  it("embedText equals text exactly when there are no headings (default embedHeadingTrail:false)", () => {
    const [chunk] = prepareChunks("Just plain text with no headings.");
    expect(chunk!.text).toBe("Just plain text with no headings.");
    expect(chunk!.embedText).toBe("Just plain text with no headings.");
  });

  it("returns no chunks for headings-only markdown (heading followed by heading, no body)", () => {
    expect(prepareChunks("# Alpha\n\n# Beta\n")).toEqual([]);
  });
});

describe("prepareChunks minAlnumChars (junk floor)", () => {
  it("keeps zero-alnum chunks by default (no junk floor)", () => {
    expect(prepareChunks(THREE_SECTIONS).map((c) => c.text)).toEqual([
      "---",
      "| 200-400mA | 5V |",
      "Real prose about power budgets.",
    ]);
  });

  it("keeps the sparse table row at floor 8 and drops the separator stub, keeping chunkIndex dense", () => {
    const chunks = prepareChunks(THREE_SECTIONS, { minAlnumChars: 8 });
    expect(chunks.map((c) => c.text)).toEqual(["| 200-400mA | 5V |", "Real prose about power budgets."]);
    expect(chunks.map((c) => c.chunkIndex)).toEqual([0, 1]);
  });

  it("rejects a negative or fractional floor at call time", () => {
    expect(() => prepareChunks("hi", { minAlnumChars: -1 } as unknown as PrepareChunksOptions)).toThrow();
    expect(() => prepareChunks("hi", { minAlnumChars: 1.5 } as unknown as PrepareChunksOptions)).toThrow();
  });

  it("floors every chunk when minAlnumChars exceeds all chunks' alnum counts", () => {
    expect(prepareChunks(THREE_SECTIONS, { minAlnumChars: 1000 })).toEqual([]);
  });
});

describe("prepareChunks embedHeadingTrail", () => {
  it("embeds '<trail joined with \" > \">: <text>' while text stays raw", () => {
    const [chunk] = prepareChunks("# Guide\n\n## Setup\n\nInstall the package.", {
      embedHeadingTrail: true,
    });
    expect(chunk!.embedText).toBe("Guide > Setup: Install the package.");
    expect(chunk!.text).toBe("Install the package.");
  });

  it("embeds the raw text when a chunk has no heading trail", () => {
    const [chunk] = prepareChunks("Just plain text with no headings.", { embedHeadingTrail: true });
    expect(chunk!.embedText).toBe("Just plain text with no headings.");
  });

  it("rejects a non-boolean at call time", () => {
    expect(() =>
      prepareChunks("hi", { embedHeadingTrail: "yes" } as unknown as PrepareChunksOptions),
    ).toThrow();
  });
});

describe("prepareChunks sanitize", () => {
  it("default strips C0/C1 control chars but keeps tabs and newlines, and reaches the heading trail", () => {
    const [chunk] = prepareChunks("# Dirty Heading\n\ncol1\tcol2dirty\nsecond line");
    expect(chunk!.text).toBe("col1\tcol2dirty\nsecond line");
    expect(chunk!.headingTrail).toEqual(["Dirty Heading"]);
    expect(chunk!.embedText).toBe("Dirty Heading\ncol1\tcol2dirty\nsecond line");
  });

  it("applies sanitize before the junk floor (the floor counts sanitized text)", () => {
    const chunks = prepareChunks(THREE_SECTIONS, {
      minAlnumChars: 8,
      // Deleting digits drops the table row ("| -mA | V |" → 3 alnum) but not the prose.
      sanitize: (text: string) => text.replace(/\d/g, ""),
    });
    expect(chunks.map((c) => c.text)).toEqual(["Real prose about power budgets."]);
  });

  it("stores and embeds a custom sanitizer's output", () => {
    const [chunk] = prepareChunks("# H\n\nquiet body.", {
      sanitize: (text: string) => text.toUpperCase(),
    });
    expect(chunk!.text).toBe("QUIET BODY.");
    expect(chunk!.embedText).toBe("H\nQUIET BODY.");
  });

  it("rejects a non-function sanitize at call time", () => {
    expect(() => prepareChunks("hi", { sanitize: 5 } as unknown as PrepareChunksOptions)).toThrow();
  });
});

describe("prepareChunks option surface", () => {
  it("rejects unknown option keys at call time", () => {
    expect(() =>
      prepareChunks("hi", { batchsize: 10 } as unknown as PrepareChunksOptions),
    ).toThrow();
  });

  it("returns an empty array for blank input", () => {
    expect(prepareChunks("   \n  \n")).toEqual([]);
  });
});
