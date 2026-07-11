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
    jest
      .spyOn(runRgModule, "runRg")
      .mockResolvedValueOnce({ stdout: "", stderr: "", code: 1 }) // search: empty
      .mockResolvedValueOnce({ stdout: "", stderr: "", code: 0 }); // probe: files exist
    const search = searchFilesTool({ root });
    const out = await runTool(search, { pattern: "zzz" });
    expect(out).toBe("No matches.");
  });

  // ripgrep exits 1 both when it searched and found nothing AND when it searched
  // NOTHING AT ALL. Collapsing those into one "No matches." tells the agent a
  // pattern is absent from files that were never opened — and it believes the
  // tool over its own eyes. The probes below establish which fact it was.
  //
  // `--quiet` means the probe prints nothing and its EXIT CODE is the answer:
  // 0 = at least one file, 1 = none, >=2 = the probe itself broke.
  const SEARCH_EMPTY = { stdout: "", stderr: "", code: 1 };

  it("says nothing was searched when the glob matched no files", async () => {
    const spy = jest
      .spyOn(runRgModule, "runRg")
      .mockResolvedValueOnce(SEARCH_EMPTY) // the search: no matches produced
      .mockResolvedValueOnce({ stdout: "", stderr: "", code: 1 }) // probe: zero files
      .mockResolvedValueOnce({ stdout: "", stderr: "", code: 1 }); // probe --no-ignore: still zero

    const search = searchFilesTool({ root });
    const out = await runTool(search, { pattern: ";;", glob: "*.kicad_sch" });

    expect(out).not.toBe("No matches.");
    expect(out).toContain("*.kicad_sch");
    expect(out).toMatch(/matched no files/i);
    // The whole point: it must not let the agent conclude the pattern is absent.
    expect(out).toMatch(/nothing was searched/i);
    expect(out).toMatch(/NOT evidence/i);

    // The probe LISTS files (--files) and answers via its exit code (--quiet);
    // it never searches, and never buffers the tree into stdout.
    const probeArgs = spy.mock.calls[1][0];
    expect(probeArgs).toContain("--files");
    expect(probeArgs).toContain("--quiet");
    expect(probeArgs).toContain("*.kicad_sch");
  });

  // `rg --files` honors ignore rules EXACTLY as the search does, so "zero files
  // listed" does NOT mean the glob was wrong — the files may exist and simply be
  // gitignored. Blaming the glob there sends the agent hunting for a better glob
  // that cannot exist, and telling it to drop the glob hands back a confident
  // PARTIAL answer with the ignored hits silently missing.
  it("blames ignore rules, not the glob, when the matching files are ignored", async () => {
    jest
      .spyOn(runRgModule, "runRg")
      .mockResolvedValueOnce(SEARCH_EMPTY)
      .mockResolvedValueOnce({ stdout: "", stderr: "", code: 1 }) // probe: nothing visible
      .mockResolvedValueOnce({ stdout: "", stderr: "", code: 0 }); // --no-ignore: they DO exist

    const search = searchFilesTool({ root });
    const out = await runTool(search, { pattern: "NEEDLE", glob: "dist/**/*.js" });

    expect(out).toMatch(/ignore rules/i);
    expect(out).toMatch(/nothing was searched/i);
    expect(out).toMatch(/NOT evidence/i);
    // The glob was fine. Never say it wasn't.
    expect(out).not.toMatch(/matched no files/i);
    // And never advise a broader search: it would skip them too.
    expect(out).toMatch(/ignored, not missing/i);
  });

  it("reports nothing-searched with no glob at all when ignore rules exclude everything", async () => {
    // The gate is NOT "was a glob supplied" — an empty tree, or a root whose
    // ignore rules exclude every file, searches nothing with no glob at all.
    jest
      .spyOn(runRgModule, "runRg")
      .mockResolvedValueOnce(SEARCH_EMPTY)
      .mockResolvedValueOnce({ stdout: "", stderr: "", code: 1 })
      .mockResolvedValueOnce({ stdout: "", stderr: "", code: 0 });

    const search = searchFilesTool({ root });
    const out = await runTool(search, { pattern: "NEEDLE" });

    expect(out).not.toBe("No matches.");
    expect(out).toMatch(/every file in the project is excluded by ignore rules/i);
  });

  it("still reports 'No matches.' when files WERE searched and the pattern is absent", async () => {
    const spy = jest
      .spyOn(runRgModule, "runRg")
      .mockResolvedValueOnce(SEARCH_EMPTY)
      // The probe found a file, so files were searched: the negative is honest.
      .mockResolvedValueOnce({ stdout: "", stderr: "", code: 0 });

    const search = searchFilesTool({ root });
    const out = await runTool(search, { pattern: "zzz", glob: "src/**/*.ts" });
    expect(out).toBe("No matches.");
    // Cause established in one probe — no need for the --no-ignore follow-up.
    expect(spy).toHaveBeenCalledTimes(2);
  });

  // A FAILING probe must never be laundered into a claim about the glob. If we
  // don't know why the search was empty, we say the plain, weaker thing.
  it("falls back to 'No matches.' when the probe itself fails, inventing no cause", async () => {
    jest
      .spyOn(runRgModule, "runRg")
      .mockResolvedValueOnce(SEARCH_EMPTY)
      .mockResolvedValueOnce({ stdout: "", stderr: "rg: broke", code: 2 });

    const search = searchFilesTool({ root });
    const out = await runTool(search, { pattern: "zzz", glob: "src/**/*.ts" });
    expect(out).toBe("No matches.");
    expect(out).not.toMatch(/matched no files/i);
    expect(out).not.toMatch(/ignore rules/i);
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

  // The field failure, verbatim: a correct query whose glob matches no files.
  // The control (searching without the glob) proves the pattern IS in the
  // corpus — so a bare "No matches." here would be a lie, and the agent that
  // believed it re-read the file six times hunting for lines it had seen.
  it("distinguishes 'nothing was searched' from 'searched, found nothing'", async () => {
    const search = searchFilesTool({ root });

    // Control: the pattern is genuinely present.
    const control = await runTool(search, { pattern: "NEEDLE" });
    expect(control).toContain("src/alpha.ts");

    // Same pattern, but the glob matches zero files in this corpus.
    const scoped = await runTool(search, { pattern: "NEEDLE", glob: "*.kicad_sch" });
    expect(scoped).not.toBe("No matches.");
    expect(scoped).toMatch(/matched no files/i);
    expect(scoped).toMatch(/nothing was searched/i);

    // And the honest negative still reads as before: the glob matched a real
    // file, the pattern simply isn't in it.
    const honest = await runTool(search, { pattern: "definitely_absent_xyz", glob: "**/beta.ts" });
    expect(honest).toBe("No matches.");
  });

  // `rg --files` obeys ignore rules exactly as the search does, so a glob
  // pointed at ignored files lists nothing — and naively that reads as "your
  // glob is wrong". It isn't. The fixture's .ignore excludes ignored/, and
  // ignored/skip.ts genuinely contains NEEDLE.
  it("names ignore rules — not the glob — when the matching files are ignored", async () => {
    const search = searchFilesTool({ root });
    const out = await runTool(search, { pattern: "NEEDLE", glob: "ignored/**" });

    expect(out).not.toBe("No matches.");
    expect(out).toMatch(/ignore rules/i);
    expect(out).toMatch(/nothing was searched/i);
    // The glob was correct — never blame it, and never send the agent hunting
    // for a better one that cannot exist.
    expect(out).not.toMatch(/matched no files/i);
  });
});
