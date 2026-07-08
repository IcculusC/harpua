import { readLinesTool } from "../code-exploration/read-lines";
import {
  makeTmpDir,
  numberedLines,
  removeTmpDir,
  runTool,
  writeBinaryFile,
  writeFile,
} from "./tmp-tree";

describe("read_lines", () => {
  let root: string;
  beforeEach(() => {
    root = makeTmpDir();
    writeFile(root, "ten.txt", numberedLines(10));
  });
  afterEach(() => removeTmpDir(root));

  it("returns the first page with a header, numbering, and a next-page hint", async () => {
    const read = readLinesTool({ root, pageLines: 3 });
    const out = await runTool(read, { path: "ten.txt" });
    expect(out).toContain("ten.txt — lines 1–3 of 10");
    expect(out).toContain("1  line01");
    expect(out).toContain("3  line03");
    expect(out).not.toContain("line04");
    expect(out).toContain("… 7 more lines — call again with start=4");
  });

  it("pages from a given start", async () => {
    const read = readLinesTool({ root, pageLines: 3 });
    const out = await runTool(read, { path: "ten.txt", start: 4 });
    expect(out).toContain("ten.txt — lines 4–6 of 10");
    expect(out).toContain("4  line04");
    expect(out).toContain("call again with start=7");
  });

  it("returns a final short page with no next-page hint", async () => {
    const read = readLinesTool({ root, pageLines: 3 });
    const out = await runTool(read, { path: "ten.txt", start: 10 });
    expect(out).toContain("ten.txt — lines 10–10 of 10");
    expect(out).toContain("10  line10");
    expect(out).not.toContain("call again");
  });

  it("reports when start is past the end of the file", async () => {
    const read = readLinesTool({ root, pageLines: 3 });
    const out = await runTool(read, { path: "ten.txt", start: 11 });
    expect(out).toMatch(/start=11 is past the end .* \(10 lines\)/);
  });

  it("handles a file with no trailing newline (last line still counts)", async () => {
    writeFile(root, "no-nl.txt", "alpha\nbeta\ngamma");
    const read = readLinesTool({ root, pageLines: 200 });
    const out = await runTool(read, { path: "no-nl.txt" });
    expect(out).toContain("no-nl.txt — lines 1–3 of 3");
    expect(out).toContain("3  gamma");
  });

  it("reports an empty file", async () => {
    writeFile(root, "empty.txt", "");
    const read = readLinesTool({ root });
    const out = await runTool(read, { path: "empty.txt" });
    expect(out).toContain("empty.txt — empty file (0 lines).");
  });

  it("refuses a binary file, pointing at file_stats", async () => {
    writeBinaryFile(root, "logo.png");
    const read = readLinesTool({ root });
    const out = await runTool(read, { path: "logo.png" });
    expect(out).toMatch(/looks binary/);
    expect(out).toMatch(/file_stats/);
  });

  it("refuses an oversize file, pointing at search_code/file_stats", async () => {
    writeFile(root, "big.txt", numberedLines(1000));
    const read = readLinesTool({ root, maxFileBytes: 100 });
    const out = await runTool(read, { path: "big.txt" });
    expect(out).toMatch(/over the 100-byte limit/);
    expect(out).toMatch(/search_code/);
  });

  it("reports a missing file", async () => {
    const read = readLinesTool({ root });
    const out = await runTool(read, { path: "ghost.txt" });
    expect(out).toMatch(/no such file/);
  });

  it("refuses a directory path", async () => {
    writeFile(root, "sub/x.txt", "hi\n");
    const read = readLinesTool({ root });
    const out = await runTool(read, { path: "sub" });
    expect(out).toMatch(/is a directory/);
  });
});
