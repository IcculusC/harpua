import fs from "node:fs";
import path from "node:path";

import { readLinesTool } from "../file-exploration/read-lines";
import { fileStatsTool } from "../file-exploration/file-stats";
import {
  makeTmpDir,
  removeTmpDir,
  runTool,
  writeFile,
} from "./tmp-tree";

describe("sandbox confinement", () => {
  let root: string;
  let outside: string;

  beforeEach(() => {
    root = makeTmpDir("agent-tools-root-");
    outside = makeTmpDir("agent-tools-outside-");
    writeFile(root, "inside.txt", "safe\n");
    writeFile(outside, "secret.txt", "top secret\n");
  });
  afterEach(() => {
    removeTmpDir(root);
    removeTmpDir(outside);
  });

  it("refuses `..` traversal, naming the root", async () => {
    const read = readLinesTool({ root });
    const out = await runTool(read, { path: "../agent-tools-outside-XXX/secret.txt" });
    expect(out).toMatch(/outside the sandbox root/);
    expect(out).toContain(root);
  });

  it("refuses an absolute path outside the root", async () => {
    const read = readLinesTool({ root });
    const out = await runTool(read, { path: path.join(outside, "secret.txt") });
    expect(out).toMatch(/outside the sandbox root/);
  });

  it("refuses a symlink that escapes the root", async () => {
    // A symlink inside root pointing at the outside directory.
    fs.symlinkSync(outside, path.join(root, "escape"));
    const read = readLinesTool({ root });
    const out = await runTool(read, { path: "escape/secret.txt" });
    expect(out).toMatch(/outside the sandbox root/);
    expect(out).toContain(root);
  });

  it("does NOT treat a sibling dir sharing the root's prefix as inside", async () => {
    // Sibling like `${root}-evil` must not pass a naive string prefix check.
    const sibling = `${root}-evil`;
    fs.mkdirSync(sibling, { recursive: true });
    writeFile(sibling, "x.txt", "nope\n");
    try {
      const read = readLinesTool({ root });
      const out = await runTool(read, { path: path.join(sibling, "x.txt") });
      expect(out).toMatch(/outside the sandbox root/);
    } finally {
      removeTmpDir(sibling);
    }
  });

  it("allows a path that resolves inside the root", async () => {
    const read = readLinesTool({ root });
    const out = await runTool(read, { path: "inside.txt" });
    expect(out).toContain("safe");
  });

  it("file_stats refuses an escaping path too", async () => {
    const stats = fileStatsTool({ root });
    const out = await runTool(stats, { path: path.join(outside, "secret.txt") });
    expect(out).toMatch(/outside the sandbox root/);
  });
});
