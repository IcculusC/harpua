import { execFileSync } from "node:child_process";

import { searchFilesTool, RG_MISSING_MESSAGE } from "../file-exploration/search-files";
import * as runRgModule from "../file-exploration/run-rg";
import type { RgResult } from "../file-exploration/run-rg";
import { makeTmpDir, removeTmpDir, runTool, writeFile } from "./tmp-tree";

/** Build ripgrep-style `path:line:text` output for `n` synthetic matches. */
function fakeMatches(n: number): string {
  const rows: string[] = [];
  for (let i = 1; i <= n; i++) rows.push(`src/file${i}.ts:${i}:const x = ${i};`);
  return rows.join("\n") + "\n";
}

function stubRg(result: RgResult): jest.SpyInstance {
  return jest.spyOn(runRgModule, "runRg").mockResolvedValue(result);
}

describe("search_files (injected exec seam)", () => {
  let root: string;
  beforeEach(() => {
    root = makeTmpDir();
  });
  afterEach(() => {
    jest.restoreAllMocks();
    removeTmpDir(root);
  });

  it("passes a safe argument array to ripgrep (no shell, `--` guard)", async () => {
    const spy = stubRg({ stdout: fakeMatches(1), stderr: "", code: 0 });
    const search = searchFilesTool({ root });
    await runTool(search, { pattern: "--danger", glob: "src/**/*.ts" });

    const [args, cwd] = spy.mock.calls[0];
    expect(cwd).toBe(root);
    expect(args).toContain("--color=never");
    expect(args).toContain("--glob");
    // The pattern sits after the `--` terminator (a leading dash is inert),
    // followed by an explicit "." search path so ripgrep never reads stdin.
    expect(args[args.length - 1]).toBe(".");
    expect(args[args.length - 2]).toBe("--danger");
    expect(args[args.length - 3]).toBe("--");
  });

  it("returns matches unchanged when under the caps", async () => {
    stubRg({ stdout: fakeMatches(3), stderr: "", code: 0 });
    const search = searchFilesTool({ root });
    const out = await runTool(search, { pattern: "const" });
    expect(out).toContain("src/file1.ts:1:const x = 1;");
    expect(out).toContain("src/file3.ts:3:const x = 3;");
    expect(out).not.toMatch(/truncated/);
  });

  it("caps by maxMatches with a truncation marker", async () => {
    stubRg({ stdout: fakeMatches(60), stderr: "", code: 0 });
    const search = searchFilesTool({ root, maxMatches: 50 });
    const out = await runTool(search, { pattern: "const" });
    const shown = out.split("\n").filter((l) => l.startsWith("src/"));
    expect(shown).toHaveLength(50);
    expect(out).toContain("… truncated: 10 more matches — narrow your pattern or add a glob");
  });

  it("caps by maxOutputBytes with a truncation marker", async () => {
    stubRg({ stdout: fakeMatches(40), stderr: "", code: 0 });
    const search = searchFilesTool({ root, maxMatches: 40, maxOutputBytes: 80 });
    const out = await runTool(search, { pattern: "const" });
    const shown = out.split("\n").filter((l) => l.startsWith("src/"));
    expect(shown.length).toBeLessThan(40);
    expect(shown.length).toBeGreaterThan(0);
    expect(out).toMatch(/… truncated: \d+ more matches/);
  });

  it("reports no matches distinctly from an error (exit 1)", async () => {
    stubRg({ stdout: "", stderr: "", code: 1 });
    const search = searchFilesTool({ root });
    const out = await runTool(search, { pattern: "zzz" });
    expect(out).toBe("No matches.");
  });

  it("surfaces a real ripgrep error (exit >= 2)", async () => {
    stubRg({ stdout: "", stderr: "regex parse error: unclosed group", code: 2 });
    const search = searchFilesTool({ root });
    const out = await runTool(search, { pattern: "(" });
    expect(out).toMatch(/search_files failed: regex parse error/);
  });

  it("gives an install hint when ripgrep is missing (ENOENT)", async () => {
    const err = new Error("spawn rg ENOENT") as NodeJS.ErrnoException;
    err.code = "ENOENT";
    jest.spyOn(runRgModule, "runRg").mockRejectedValue(err);
    const search = searchFilesTool({ root });
    const out = await runTool(search, { pattern: "const" });
    expect(out).toBe(RG_MISSING_MESSAGE);
    expect(out).toMatch(/brew install ripgrep/);
  });
});

/** Real ripgrep integration — auto-skips on machines without `rg`. */
const rgAvailable = (): boolean => {
  try {
    execFileSync("rg", ["--version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
};

(rgAvailable() ? describe : describe.skip)("search_files (real ripgrep integration)", () => {
  let root: string;
  beforeEach(() => {
    root = makeTmpDir();
    writeFile(root, "src/alpha.ts", "export const NEEDLE = 1;\n");
    writeFile(root, "src/beta.ts", "const other = 2;\n");
    writeFile(root, "ignored/skip.ts", "const NEEDLE = 3;\n");
    // ripgrep always honors `.ignore` files (and `.gitignore` inside a git
    // repo); `.ignore` keeps this fixture deterministic without spawning git.
    writeFile(root, ".ignore", "ignored/\n");
  });
  afterEach(() => removeTmpDir(root));

  it("finds a real match and honors ignore files + globs", async () => {
    const search = searchFilesTool({ root });
    const out = await runTool(search, { pattern: "NEEDLE" });
    expect(out).toContain("src/alpha.ts:1:export const NEEDLE = 1;");
    // The ignore rule is respected, so the ignored copy is not returned.
    expect(out).not.toContain("ignored/skip.ts");

    const scoped = await runTool(search, { pattern: "const", glob: "**/beta.ts" });
    expect(scoped).toContain("src/beta.ts");
    expect(scoped).not.toContain("alpha.ts");
  });

  it("returns 'No matches.' for a pattern that is absent", async () => {
    const search = searchFilesTool({ root });
    const out = await runTool(search, { pattern: "definitely_absent_token_xyz" });
    expect(out).toBe("No matches.");
  });
});
