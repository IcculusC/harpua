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
  // Probes widen the reach ONE mechanism at a time, so the first one that finds
  // the file names the mechanism that excluded it:
  //   call 0  the search        1 = produced nothing
  //   call 1  probe, no reach   mirrors the search exactly
  //   call 2  probe + --hidden  found only here => the files are HIDDEN
  //   call 3  probe + ignore    found only here => the files are IGNORED
  const EMPTY = { stdout: "", stderr: "", code: 1 };
  const FOUND = { stdout: "", stderr: "", code: 0 };
  const BROKE = { stdout: "", stderr: "rg: broke", code: 2 };

  it("says nothing was searched when the glob matched no files", async () => {
    const spy = jest
      .spyOn(runRgModule, "runRg")
      .mockResolvedValueOnce(EMPTY) // search
      .mockResolvedValueOnce(EMPTY) // as-searched
      .mockResolvedValueOnce(EMPTY) // +hidden
      .mockResolvedValueOnce(EMPTY); // +ignored — nothing, under any reach

    const search = searchFilesTool({ root });
    const out = await runTool(search, { pattern: ";;", glob: "*.kicad_sch" });

    expect(out).not.toBe("No matches.");
    expect(out).toContain("*.kicad_sch");
    expect(out).toMatch(/matched no files/i);
    // The whole point: it must not let the agent conclude the pattern is absent.
    expect(out).toMatch(/nothing was searched/i);
    expect(out).toMatch(/NOT evidence/i);

    // The probe LISTS files (--files) and answers via its exit code (--quiet).
    // The first probe must mirror the search: no widening flags at all, or the
    // comparison that names the cause is meaningless.
    const asSearched = spy.mock.calls[1][0];
    expect(asSearched).toContain("--files");
    expect(asSearched).toContain("--quiet");
    expect(asSearched).toContain("*.kicad_sch");
    expect(asSearched).not.toContain("--hidden");
    expect(asSearched).not.toContain("--no-ignore");
  });

  // The search NEVER passes --hidden, so it skips .github/, .env, .vscode/ etc.
  // Reporting that as "excluded by ignore rules" is a lie with no fixable cause,
  // and telling the agent to give up abandons a file it could simply read.
  it("names hidden files — not ignore rules — when the search skipped dotfiles", async () => {
    const spy = jest
      .spyOn(runRgModule, "runRg")
      .mockResolvedValueOnce(EMPTY) // search: skips hidden
      .mockResolvedValueOnce(EMPTY) // as-searched: also skips hidden
      .mockResolvedValueOnce(FOUND); // +hidden: there they are

    const search = searchFilesTool({ root });
    const out = await runTool(search, { pattern: "actions/checkout", glob: ".github/**" });

    expect(out).toMatch(/hidden/i);
    expect(out).toMatch(/read_lines/);
    expect(out).toMatch(/NOT evidence/i);
    // The glob was correct and nothing is gitignored. Never claim either.
    expect(out).not.toMatch(/matched no files/i);
    expect(out).not.toMatch(/ignore rules/i);
    // Stops at the hidden probe — no reason to ask about ignore rules.
    expect(spy).toHaveBeenCalledTimes(3);

    const hiddenProbe = spy.mock.calls[2][0];
    expect(hiddenProbe).toContain("--hidden");
    expect(hiddenProbe).not.toContain("--no-ignore");
  });

  // `rg --files` honors ignore rules EXACTLY as the search does, so "zero files
  // listed" does NOT mean the glob was wrong — the files may exist and simply be
  // gitignored. Blaming the glob sends the agent hunting for a better glob that
  // cannot exist; telling it to drop the glob hands back a confident PARTIAL
  // answer with the ignored hits silently missing.
  it("blames ignore rules, not the glob, when the matching files are ignored", async () => {
    const spy = jest
      .spyOn(runRgModule, "runRg")
      .mockResolvedValueOnce(EMPTY)
      .mockResolvedValueOnce(EMPTY)
      .mockResolvedValueOnce(EMPTY) // not hidden either
      .mockResolvedValueOnce(FOUND); // only visible past ignore rules

    const search = searchFilesTool({ root });
    const out = await runTool(search, { pattern: "NEEDLE", glob: "dist/**/*.js" });

    expect(out).toMatch(/ignore rules/i);
    expect(out).toMatch(/NOT evidence/i);
    expect(out).not.toMatch(/matched no files/i);
    // Never advise a broader search: it would skip them too.
    expect(out).toMatch(/ignored, not missing/i);

    // The widened probes must not wander into .git/, and ripgrep globs are
    // LAST-MATCH-WINS — so the guard has to come AFTER the caller's glob or it
    // silently loses to it.
    const ignoreProbe = spy.mock.calls[3][0] as string[];
    expect(ignoreProbe).toContain("--no-ignore");
    expect(ignoreProbe).toContain("!.git/**");
    expect(ignoreProbe.lastIndexOf("!.git/**")).toBeGreaterThan(
      ignoreProbe.lastIndexOf("dist/**/*.js"),
    );
  });

  it("reports nothing-searched with no glob at all when ignore rules exclude everything", async () => {
    // The gate is NOT "was a glob supplied" — an empty tree, or a root whose
    // ignore rules exclude every file, searches nothing with no glob at all.
    jest
      .spyOn(runRgModule, "runRg")
      .mockResolvedValueOnce(EMPTY)
      .mockResolvedValueOnce(EMPTY)
      .mockResolvedValueOnce(EMPTY)
      .mockResolvedValueOnce(FOUND);

    const search = searchFilesTool({ root });
    const out = await runTool(search, { pattern: "NEEDLE" });

    expect(out).not.toBe("No matches.");
    expect(out).toMatch(/every file in the project is excluded by ignore rules/i);
  });

  it("still reports 'No matches.' when files WERE searched and the pattern is absent", async () => {
    const spy = jest
      .spyOn(runRgModule, "runRg")
      .mockResolvedValueOnce(EMPTY)
      // The probe mirroring the search found a file: the negative is honest.
      .mockResolvedValueOnce(FOUND);

    const search = searchFilesTool({ root });
    const out = await runTool(search, { pattern: "zzz", glob: "src/**/*.ts" });
    expect(out).toBe("No matches.");
    // Cause settled in one probe — don't pay for the widened ones.
    expect(spy).toHaveBeenCalledTimes(2);
  });

  // A FAILING probe must never be laundered into a claim about the files. Each
  // probe needs its own guard: without one, a crash falls through to whichever
  // cause the code checks last and gets stated as fact.
  it.each([
    ["the first probe", [EMPTY, BROKE]],
    ["the hidden probe", [EMPTY, EMPTY, BROKE]],
    ["the ignore probe", [EMPTY, EMPTY, EMPTY, BROKE]],
  ])("falls back to 'No matches.' when %s fails, inventing no cause", async (_label, seq) => {
    const spy = jest.spyOn(runRgModule, "runRg");
    for (const r of seq) spy.mockResolvedValueOnce(r);

    const search = searchFilesTool({ root });
    const out = await runTool(search, { pattern: "zzz", glob: "src/**/*.ts" });

    expect(out).toBe("No matches.");
    expect(out).not.toMatch(/matched no files/i);
    expect(out).not.toMatch(/ignore rules/i);
    expect(out).not.toMatch(/hidden/i);
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

  // ripgrep skips hidden files unless told otherwise, and this tool never tells
  // it otherwise. `.github/**` is an everyday agent target, and NOTHING about it
  // is gitignored — so calling it "ignored" is a lie with no cause the agent can
  // find or fix, and "give up, a broader search skips them too" is worse: rg
  // would read this file happily.
  it("names hidden files — not ignore rules — for a dotfile target like .github/", async () => {
    writeFile(root, ".github/workflows/ci.yml", "steps:\n  - uses: actions/checkout@v4\n");
    const search = searchFilesTool({ root });
    const out = await runTool(search, { pattern: "actions/checkout", glob: ".github/**" });

    expect(out).not.toBe("No matches.");
    expect(out).toMatch(/hidden/i);
    expect(out).toMatch(/read_lines/);
    expect(out).not.toMatch(/ignore rules/i);
    expect(out).not.toMatch(/matched no files/i);
  });

  // The widened probes see past ignore rules AND hidden files — which means they
  // walk .git/, a tree the search never touches. Without the `!.git/**` guard,
  // a glob like "**/config" matches .git/config and the tool reports git
  // plumbing as though it were the user's own gitignored source file.
  it("does not mistake .git/ plumbing for the user's ignored files", async () => {
    writeFile(root, ".git/config", "[core]\n\trepositoryformatversion = 0\n");
    const search = searchFilesTool({ root });
    const out = await runTool(search, { pattern: "repositoryformatversion", glob: "**/config" });

    // There is no user file named `config` — the honest answer, and the one the
    // agent can act on. Never "it exists but is ignored/hidden".
    expect(out).toMatch(/matched no files/i);
    expect(out).not.toMatch(/ignore rules/i);
    expect(out).not.toMatch(/hidden/i);
  });
});
