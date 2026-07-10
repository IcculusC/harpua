import { chunkMarkdown } from "../knowledge/chunk-markdown";

const OPTS = { maxChunkChars: 1200 };

const PAGE = [
  "---", // 1
  "url: https://ti.com/lm317", // 2
  "title: LM317", // 3
  "fetched: 2026-07-09", // 4
  "---", // 5
  "", // 6
  "# LM317", // 7
  "", // 8
  "An adjustable regulator.", // 9
  "", // 10
  "## Electrical Characteristics", // 11
  "", // 12
  "- Dropout: 1.5 V @ 1 A", // 13
  "- Package: TO-220", // 14
  "", // 15
  "### Thermal", // 16
  "", // 17
  "Junction to ambient 50 C/W.", // 18
].join("\n");

describe("chunkMarkdown", () => {
  it("splits at headings with true line spans and heading trails", () => {
    const chunks = chunkMarkdown(PAGE, OPTS);
    expect(chunks).toHaveLength(3);

    expect(chunks[0]).toMatchObject({
      startLine: 7,
      endLine: 10,
      headingTrail: ["LM317"],
    });
    expect(chunks[0]!.text).toContain("An adjustable regulator.");

    expect(chunks[1]).toMatchObject({
      startLine: 11,
      endLine: 15,
      headingTrail: ["LM317", "Electrical Characteristics"],
    });
    expect(chunks[1]!.text).toContain("Dropout: 1.5 V @ 1 A");

    expect(chunks[2]).toMatchObject({
      startLine: 16,
      endLine: 18,
      headingTrail: ["LM317", "Electrical Characteristics", "Thermal"],
    });
  });

  it("excludes frontmatter from chunk text but keeps line numbers true", () => {
    const chunks = chunkMarkdown(PAGE, OPTS);
    expect(chunks[0]!.text).not.toContain("fetched:");
    expect(chunks[0]!.startLine).toBe(7); // not 2
  });

  it("chunks content before any heading, with an empty trail", () => {
    const chunks = chunkMarkdown("plain text\nwith no headings", OPTS);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toMatchObject({ startLine: 1, endLine: 2, headingTrail: [] });
  });

  it("splits oversized sections at paragraph boundaries", () => {
    const paragraph = "word ".repeat(100).trim(); // ~500 chars
    const md = ["## Big", "", paragraph, "", paragraph, "", paragraph].join("\n");
    const chunks = chunkMarkdown(md, { maxChunkChars: 700 });
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.headingTrail).toEqual(["Big"]);
      expect(chunk.text.length).toBeLessThanOrEqual(700 + paragraph.length);
    }
    // spans must tile without overlap
    for (let i = 1; i < chunks.length; i++) {
      expect(chunks[i]!.startLine).toBeGreaterThan(chunks[i - 1]!.endLine);
    }
  });

  it("hard-splits a single over-cap paragraph so no chunk exceeds the cap", () => {
    // Field regression: fetch_pdf extractions used to arrive as one giant
    // blank-line-free paragraph; "never split mid-paragraph" shipped 148KB
    // chunks no embedding endpoint accepts.
    const huge = "word ".repeat(500).trim(); // one 2499-char line
    const chunks = chunkMarkdown(`## Big\n\n${huge}`, { maxChunkChars: 100 });
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) {
      expect(c.text.length).toBeLessThanOrEqual(100);
      // Raw slices of one physical line keep that line's true span.
      expect(c.startLine).toBe(3);
      expect(c.endLine).toBe(3);
    }
    // Nothing lost beyond the standard per-chunk trim: every word survives.
    const words = chunks.flatMap((c) => c.text.split(/\s+/)).filter(Boolean);
    expect(words).toHaveLength(500);
    expect(words.every((w) => w === "word")).toBe(true);
  });

  it("splits an over-cap multi-line paragraph at line boundaries", () => {
    const lines = Array.from(
      { length: 20 },
      (_, i) => `line ${i} of dense text with no blank separators`,
    );
    const chunks = chunkMarkdown(`## Dense\n\n${lines.join("\n")}`, {
      maxChunkChars: 120,
    });
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) {
      expect(c.text.length).toBeLessThanOrEqual(120);
      // Line-boundary splits: chunk text is whole lines, never mid-line.
      expect(lines.join("\n")).toContain(c.text);
    }
    expect(chunks[chunks.length - 1]!.endLine).toBe(3 + lines.length - 1);
  });

  it("drops whitespace-only sections and handles empty input", () => {
    expect(chunkMarkdown("", OPTS)).toEqual([]);
    expect(chunkMarkdown("## Empty\n\n\n## Also Empty", OPTS)).toEqual([]);
  });
});
