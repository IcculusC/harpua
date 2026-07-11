import fs from "node:fs";
import path from "node:path";

import { readLinesTool } from "../file-exploration/read-lines";
import { fileStatsTool } from "../file-exploration/file-stats";
import { makeTmpDir, removeTmpDir, runTool, writeFile } from "./tmp-tree";

const SECRET = "AWS_SECRET_ACCESS_KEY=hunter2\n";

describe("secret-path guard (through the real tools)", () => {
  let root: string;
  beforeEach(() => {
    root = makeTmpDir("agent-tools-secret-");
    writeFile(root, ".env", SECRET);
    writeFile(root, "src/app.ts", "export const x = 1;\n");
  });
  afterEach(() => removeTmpDir(root));

  it("read_lines refuses a direct secret path and never leaks the contents", async () => {
    const read = readLinesTool({ root });
    const out = await runTool(read, { path: ".env" });
    expect(out).not.toContain("hunter2");
    expect(out).toMatch(/secret/i);
  });

  it("read_lines still reads ordinary files", async () => {
    const read = readLinesTool({ root });
    const out = await runTool(read, { path: "src/app.ts" });
    expect(out).toContain("export const x = 1;");
  });

  it("read_lines still reads a non-secret dotfile (.github is not a secret)", async () => {
    writeFile(root, ".github/workflows/ci.yml", "on: push\n");
    const read = readLinesTool({ root });
    const out = await runTool(read, { path: ".github/workflows/ci.yml" });
    expect(out).toContain("on: push");
  });

  it("file_stats refuses to stat a secret path", async () => {
    const stats = fileStatsTool({ root });
    const out = await runTool(stats, { path: ".env" });
    expect(out).not.toContain("hunter2");
    expect(out).toMatch(/secret/i);
  });

  // THE symlink attack: a harmless-looking name pointing at the secret. The guard
  // must see the REAL target, not the link's name.
  it("read_lines refuses a symlink whose target is a secret", async () => {
    fs.symlinkSync(path.join(root, ".env"), path.join(root, "notes.txt"));
    const read = readLinesTool({ root });
    const out = await runTool(read, { path: "notes.txt" });
    expect(out).not.toContain("hunter2");
    expect(out).toMatch(/secret/i);
  });

  // A symlinked DIRECTORY into a secret dir, then a normal-looking file under it.
  it("read_lines refuses a file reached through a symlinked secret directory", async () => {
    writeFile(root, ".aws/credentials", SECRET);
    fs.symlinkSync(path.join(root, ".aws"), path.join(root, "cfg"));
    const read = readLinesTool({ root });
    const out = await runTool(read, { path: "cfg/credentials" });
    expect(out).not.toContain("hunter2");
    expect(out).toMatch(/secret/i);
  });

  // Traversal that normalizes back onto the secret must not dodge the guard.
  it("read_lines refuses a secret reached via a normalizing path", async () => {
    const read = readLinesTool({ root });
    const out = await runTool(read, { path: "src/../.env" });
    expect(out).not.toContain("hunter2");
    expect(out).toMatch(/secret/i);
  });

  // A chain: link -> link -> .env. realpath collapses the whole chain.
  it("read_lines refuses a multi-hop symlink chain to a secret", async () => {
    fs.symlinkSync(path.join(root, ".env"), path.join(root, "hop1"));
    fs.symlinkSync(path.join(root, "hop1"), path.join(root, "hop2.txt"));
    const read = readLinesTool({ root });
    const out = await runTool(read, { path: "hop2.txt" });
    expect(out).not.toContain("hunter2");
    expect(out).toMatch(/secret/i);
  });

  // The refusal must NOT tell the agent how to get the file another way.
  it("the refusal advertises no bypass", async () => {
    const read = readLinesTool({ root });
    const out = await runTool(read, { path: ".env" });
    expect(out).not.toMatch(/search_files|file_stats|cat\b/i);
  });

  // The guard matches the ROOT-RELATIVE path, not the absolute one. If the
  // sandbox root itself lives under a secret-named ancestor (a repo checked out
  // inside ~/.ssh, say), matching the absolute path would refuse EVERY file.
  // This pins that: ordinary files stay readable, only a relative secret is
  // refused, no matter what the root's own path contains.
  it("reads normal files when the root sits under a secret-named ancestor", async () => {
    const parent = makeTmpDir("agent-tools-nested-");
    // `.ssh` as a genuine path COMPONENT of the root's absolute path — matching
    // the absolute path (the M2 bug) would then refuse every file under it.
    const nestedRoot = path.join(parent, ".ssh", "project");
    fs.mkdirSync(nestedRoot, { recursive: true });
    writeFile(nestedRoot, "app.ts", "export const ok = true;\n");
    writeFile(nestedRoot, ".env", SECRET);
    try {
      const read = readLinesTool({ root: nestedRoot });
      // The root's absolute path contains a secret-looking segment, yet a
      // normal file inside is readable...
      expect(await runTool(read, { path: "app.ts" })).toContain("export const ok");
      // ...while a genuinely-secret RELATIVE path is still refused.
      const denied = await runTool(read, { path: ".env" });
      expect(denied).not.toContain("hunter2");
      expect(denied).toMatch(/secret/i);
    } finally {
      removeTmpDir(parent);
    }
  });

  // A custom empty policy disables the guard (opt-out remains possible).
  it("an empty blockedSecretPatterns disables the guard", async () => {
    const read = readLinesTool({ root, blockedSecretPatterns: [] });
    const out = await runTool(read, { path: ".env" });
    expect(out).toContain("hunter2");
  });

  // A caller can extend the policy with their own secret.
  it("a custom pattern blocks a project-specific secret file", async () => {
    writeFile(root, "config/prod.secrets.toml", "token = abc\n");
    const read = readLinesTool({
      root,
      blockedSecretPatterns: [/\.secrets\.toml$/],
    });
    const out = await runTool(read, { path: "config/prod.secrets.toml" });
    expect(out).not.toContain("token = abc");
    expect(out).toMatch(/secret/i);
  });
});
