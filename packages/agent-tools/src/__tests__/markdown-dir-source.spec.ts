import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { readMarkdownDir } from "../knowledge/markdown-dir-source";

describe("readMarkdownDir", () => {
  it("returns one document per .md file, sorted, id=file, metadata={file}", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mddir-"));
    fs.writeFileSync(path.join(dir, "b.md"), "# B\n\nbeta");
    fs.writeFileSync(path.join(dir, "a.md"), "# A\n\nalpha");
    fs.writeFileSync(path.join(dir, "ignore.txt"), "not markdown");

    const docs = readMarkdownDir(dir);

    expect(docs.map((d) => d.id)).toEqual(["a.md", "b.md"]);
    expect(docs[0]).toEqual({ id: "a.md", text: "# A\n\nalpha", metadata: { file: "a.md" } });
  });

  it("returns [] for a missing directory", () => {
    expect(readMarkdownDir(path.join(os.tmpdir(), "does-not-exist-xyz-123"))).toEqual([]);
  });
});
