import { searchCodeTool } from "../code-exploration/search-code";
import { readLinesTool } from "../code-exploration/read-lines";
import { fileStatsTool } from "../code-exploration/file-stats";
import { codeExplorationTools } from "../code-exploration/code-exploration-tools";
import { makeTmpDir, removeTmpDir, writeFile } from "./tmp-tree";

describe("code-exploration options validation", () => {
  let root: string;
  beforeEach(() => {
    root = makeTmpDir();
  });
  afterEach(() => removeTmpDir(root));

  it("builds all three named tools from a bundle", () => {
    const tools = codeExplorationTools({ root });
    expect(tools.map((t) => t.name)).toEqual(["search_code", "read_lines", "file_stats"]);
  });

  it("rejects a missing root (zod)", () => {
    expect(() => searchCodeTool({} as never)).toThrow();
  });

  it("rejects a non-positive pageLines (zod)", () => {
    expect(() => readLinesTool({ root, pageLines: 0 })).toThrow();
  });

  it("rejects a negative maxMatches (zod)", () => {
    expect(() => searchCodeTool({ root, maxMatches: -1 })).toThrow();
  });

  it("rejects a non-integer maxOutputBytes (zod)", () => {
    expect(() => searchCodeTool({ root, maxOutputBytes: 1.5 })).toThrow();
  });

  it("rejects unknown option keys (strict)", () => {
    expect(() => fileStatsTool({ root, bogus: true } as never)).toThrow();
  });

  it("rejects a root that does not exist", () => {
    expect(() => searchCodeTool({ root: `${root}/nope` })).toThrow(/does not exist/);
  });

  it("rejects a root that is a file, not a directory", () => {
    const file = writeFile(root, "a.txt", "hi\n");
    expect(() => searchCodeTool({ root: file })).toThrow(/not a directory/);
  });

  it("exposes teaching descriptions naming the workflow", () => {
    const [search, read, stats] = codeExplorationTools({ root });
    expect(search.description).toMatch(/search before you read/i);
    expect(read.description).toMatch(/bounded page/i);
    expect(stats.description).toMatch(/before reading/i);
  });
});
