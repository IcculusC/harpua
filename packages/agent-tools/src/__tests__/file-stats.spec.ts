import { fileStatsTool } from "../code-exploration/file-stats";
import * as runRgModule from "../code-exploration/run-rg";
import {
  makeTmpDir,
  numberedLines,
  removeTmpDir,
  runTool,
  writeBinaryFile,
  writeFile,
} from "./tmp-tree";

/** Force the readdir fallback path by simulating ripgrep being absent. */
function stubRgMissing(): jest.SpyInstance {
  const err = new Error("spawn rg ENOENT") as NodeJS.ErrnoException;
  err.code = "ENOENT";
  return jest.spyOn(runRgModule, "runRg").mockRejectedValue(err);
}

describe("file_stats", () => {
  let root: string;
  beforeEach(() => {
    root = makeTmpDir();
  });
  afterEach(() => {
    jest.restoreAllMocks();
    removeTmpDir(root);
  });

  describe("on a file", () => {
    it("reports line count, byte size, and text", async () => {
      const contents = numberedLines(12);
      writeFile(root, "code.ts", contents);
      const stats = fileStatsTool({ root });
      const out = await runTool(stats, { path: "code.ts" });
      expect(out).toBe(`code.ts — 12 lines, ${Buffer.byteLength(contents)} bytes, text`);
    });

    it("counts a final line with no trailing newline", async () => {
      writeFile(root, "nonl.ts", "a\nb\nc");
      const stats = fileStatsTool({ root });
      const out = await runTool(stats, { path: "nonl.ts" });
      expect(out).toMatch(/^nonl\.ts — 3 lines,/);
    });

    it("flags a binary file and omits the line count", async () => {
      writeBinaryFile(root, "img.png");
      const stats = fileStatsTool({ root });
      const out = await runTool(stats, { path: "img.png" });
      expect(out).toMatch(/img\.png — \d+ bytes, binary/);
      expect(out).not.toMatch(/lines/);
    });

    it("skips line counting for a file over maxFileBytes", async () => {
      writeFile(root, "huge.ts", numberedLines(500));
      const stats = fileStatsTool({ root, maxFileBytes: 50 });
      const out = await runTool(stats, { path: "huge.ts" });
      expect(out).toMatch(/text \(too large to count lines\)/);
    });
  });

  describe("on a directory (readdir fallback, rg absent)", () => {
    beforeEach(() => {
      writeFile(root, "a.ts", numberedLines(3));
      writeFile(root, "b.ts", numberedLines(5));
      writeFile(root, "nested/c.ts", numberedLines(7));
    });

    it("lists files recursively with per-file line counts", async () => {
      stubRgMissing();
      const stats = fileStatsTool({ root });
      const out = await runTool(stats, {});
      expect(out).toContain(". — 3 files:");
      expect(out).toContain("a.ts — 3 lines,");
      expect(out).toContain("b.ts — 5 lines,");
      expect(out).toContain("nested/c.ts — 7 lines,");
    });

    it("skips node_modules and .git in the fallback walk", async () => {
      writeFile(root, "node_modules/dep/index.ts", "x\n");
      writeFile(root, ".git/config", "y\n");
      stubRgMissing();
      const stats = fileStatsTool({ root });
      const out = await runTool(stats, {});
      expect(out).not.toContain("node_modules");
      expect(out).not.toContain(".git");
    });

    it("caps entries with a truncation marker", async () => {
      stubRgMissing();
      const stats = fileStatsTool({ root, maxMatches: 2 });
      const out = await runTool(stats, {});
      const entryLines = out.split("\n").filter((l) => l.includes(" lines,"));
      expect(entryLines).toHaveLength(2);
      expect(out).toContain("… truncated: 1 more entries — pass a subdirectory path to narrow");
    });

    it("caps by output bytes with a truncation marker", async () => {
      stubRgMissing();
      const stats = fileStatsTool({ root, maxOutputBytes: 40 });
      const out = await runTool(stats, {});
      expect(out).toMatch(/… truncated: \d+ more entries/);
    });

    it("narrows to a subdirectory path", async () => {
      stubRgMissing();
      const stats = fileStatsTool({ root });
      const out = await runTool(stats, { path: "nested" });
      expect(out).toContain("nested — 1 file:");
      expect(out).toContain("c.ts — 7 lines,");
      expect(out).not.toContain("a.ts");
    });
  });

  describe("on a directory (ripgrep listing)", () => {
    it("uses the injected ripgrep --files output", async () => {
      writeFile(root, "x.ts", numberedLines(4));
      writeFile(root, "y.ts", numberedLines(6));
      jest
        .spyOn(runRgModule, "runRg")
        .mockResolvedValue({ stdout: "x.ts\ny.ts\n", stderr: "", code: 0 });
      const stats = fileStatsTool({ root });
      const out = await runTool(stats, {});
      expect(out).toContain(". — 2 files:");
      expect(out).toContain("x.ts — 4 lines,");
      expect(out).toContain("y.ts — 6 lines,");
    });
  });

  it("reports a missing path", async () => {
    const stats = fileStatsTool({ root });
    const out = await runTool(stats, { path: "ghost" });
    expect(out).toMatch(/no such file or directory/);
  });
});
