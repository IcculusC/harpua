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
  // Hidden and ignore rules are INDEPENDENT mechanisms, so they are probed
  // independently — a file can be excluded by either, or by both at once:
  //   call 0  the search               1 = produced nothing
  //   call 1  probe, no reach          mirrors the search exactly
  //   call 2  probe + hidden only      found only here => HIDDEN
  //   call 3  probe + ignored only     found only here => IGNORED
  //   call 4  probe + both             found only here => BOTH
  //   call 5  probe + .git/ as well    found only here => our own guard hid it
  const EMPTY = { stdout: "", stderr: "", code: 1 };
  const FOUND = { stdout: "", stderr: "", code: 0 };
  const BROKE = { stdout: "", stderr: "rg: broke", code: 2 };

  it("says nothing was searched when the glob matched no files", async () => {
    const spy = jest
      .spyOn(runRgModule, "runRg")
      .mockResolvedValueOnce(EMPTY) // search
      .mockResolvedValueOnce(EMPTY) // as-searched
      .mockResolvedValueOnce(EMPTY) // +hidden
      .mockResolvedValueOnce(EMPTY) // +ignored
      .mockResolvedValueOnce(EMPTY) // +both
      .mockResolvedValueOnce(EMPTY); // +.git — nothing, under any reach

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
      .mockResolvedValueOnce(FOUND) // +hidden: there they are
      .mockResolvedValueOnce(EMPTY); // +ignored: nothing ignored here

    const search = searchFilesTool({ root });
    const out = await runTool(search, { pattern: "actions/checkout", glob: ".github/**" });

    expect(out).toMatch(/hidden/i);
    expect(out).toMatch(/deliberate/i);
    expect(out).toMatch(/NOT evidence/i);
    // Hidden files are withheld on purpose — never hand out the read_lines bypass.
    expect(out).not.toMatch(/read_lines/);
    // The glob was correct and nothing is gitignored. Never claim either.
    expect(out).not.toMatch(/matched no files/i);
    expect(out).not.toMatch(/ignore rules/i);
    // BOTH single-mechanism probes run before concluding — otherwise a glob
    // spanning a hidden file and an ignored one would claim "every file ... is
    // hidden" and never mention the ignored one at all.
    expect(spy).toHaveBeenCalledTimes(4);

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
      .mockResolvedValueOnce(EMPTY) // not hidden
      .mockResolvedValueOnce(FOUND); // visible once ignore rules are lifted

    const search = searchFilesTool({ root });
    const out = await runTool(search, { pattern: "NEEDLE", glob: "dist/**/*.js" });

    expect(out).toMatch(/excluded by an ignore rule/i);
    expect(out).toMatch(/NOT evidence/i);
    expect(out).not.toMatch(/matched no files/i);
    // Never advise a broader search: it would skip them too.
    expect(out).toMatch(/ignored, not missing/i);
    // The rule may not even be IN the project — don't send the agent hunting
    // through a .gitignore that need not exist.
    expect(out).toMatch(/parent directory|global git config/i);
    // The files are readable. Never dead-end the agent.
    expect(out).toMatch(/read_lines/);

    // The ignore probe must NOT also lift `hidden` — that conflation is what
    // made a hidden-and-ignored file report as merely "ignored".
    const ignoreProbe = spy.mock.calls[3][0] as string[];
    expect(ignoreProbe).toContain("--no-ignore");
    expect(ignoreProbe).not.toContain("--hidden");
    // Widened probes must not wander into .git/, and ripgrep globs are
    // LAST-MATCH-WINS — the guard has to come AFTER the caller's glob.
    expect(ignoreProbe).toContain("!.git/**");
    expect(ignoreProbe.lastIndexOf("!.git/**")).toBeGreaterThan(
      ignoreProbe.lastIndexOf("dist/**/*.js"),
    );
  });

  // `.env` listed in .gitignore. `.venv/`, `.next/`, `.turbo/`. The intersection
  // is the COMMON case, and a chain that lifts one mechanism at a time
  // misattributes it to whichever probe happens to fire first.
  it("names BOTH mechanisms when a file is hidden and ignored at once", async () => {
    const spy = jest
      .spyOn(runRgModule, "runRg")
      .mockResolvedValueOnce(EMPTY)
      .mockResolvedValueOnce(EMPTY)
      .mockResolvedValueOnce(EMPTY) // hidden alone doesn't reach it (still ignored)
      .mockResolvedValueOnce(EMPTY) // ignore alone doesn't reach it (still hidden)
      .mockResolvedValueOnce(FOUND); // only both together

    const search = searchFilesTool({ root });
    const out = await runTool(search, { pattern: "SECRET", glob: ".env" });

    expect(out).toMatch(/BOTH hidden and excluded by an ignore rule/i);
    expect(out).toMatch(/no glob overrides it/i);
    expect(out).not.toMatch(/read_lines/);
    expect(out).not.toMatch(/matched no files/i);

    // The both-probe must genuinely lift BOTH. (Dropping --hidden here is the
    // mutation that previously survived the entire suite.)
    const bothProbe = spy.mock.calls[4][0] as string[];
    expect(bothProbe).toContain("--hidden");
    expect(bothProbe).toContain("--no-ignore");
  });

  // Our own `!.git/**` guard is last-match-wins, so it overrides a caller who
  // MEANT .git/**. Blaming their glob for files our guard hid is the same lie.
  it("admits it was our own .git guard, not the caller's glob", async () => {
    const spy = jest
      .spyOn(runRgModule, "runRg")
      .mockResolvedValueOnce(EMPTY)
      .mockResolvedValueOnce(EMPTY)
      .mockResolvedValueOnce(EMPTY)
      .mockResolvedValueOnce(EMPTY)
      .mockResolvedValueOnce(EMPTY) // every guarded probe is blind here
      .mockResolvedValueOnce(FOUND); // ...until we drop the guard

    const search = searchFilesTool({ root });
    const out = await runTool(search, { pattern: "url", glob: ".git/**" });

    expect(out).toMatch(/inside \.git\//i);
    expect(out).toMatch(/not a mistake in your glob/i);
    expect(out).not.toMatch(/matched no files/i);
    // Never serve the bare-directory advice for a glob that was correct.
    expect(out).not.toMatch(/bare directory name/i);

    // Only the last probe drops the guard.
    const gitProbe = spy.mock.calls[5][0] as string[];
    expect(gitProbe).not.toContain("!.git/**");
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
    expect(out).toMatch(/every file in the project is excluded by an ignore rule/i);
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
    ["the both probe", [EMPTY, EMPTY, EMPTY, EMPTY, BROKE]],
    ["the .git probe", [EMPTY, EMPTY, EMPTY, EMPTY, EMPTY, BROKE]],
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

  // SECURITY. ripgrep skips hidden files by default, but a positive --glob is a
  // WHITELIST that overrides that default AND ignore rules — so before this,
  // every one of these globs read the secret straight out of .env. The
  // protection was an accident of the default, and naming the file defeated it.
  it.each([".env", "*.env", "**/.env", "**/*", "**"])(
    "refuses to search a hidden file even when the glob names it (%s)",
    async (glob) => {
      writeFile(root, ".env", "SECRET=hunter2\n");
      const search = searchFilesTool({ root });
      const out = await runTool(search, { pattern: "SECRET", glob });

      // The invariant for EVERY glob: the secret never leaks and .env is never
      // reported as a match. (A broad glob like `**` still searches the visible
      // files and honestly says "No matches."; only a glob that targets .env
      // specifically produces the hidden message — covered below.)
      expect(out).not.toContain("hunter2");
      expect(out).not.toMatch(/\.env:\d+:/);
    },
  );

  it("still refuses the hidden file with no glob at all", async () => {
    writeFile(root, ".env", "SECRET=hunter2\n");
    const search = searchFilesTool({ root });
    const out = await runTool(search, { pattern: "SECRET" });
    expect(out).not.toContain("hunter2");
  });

  // ...and having refused, it must not then hand out the bypass. read_lines CAN
  // read .env; advertising that turns an honest refusal into a how-to guide.
  it("does not offer a read_lines workaround for hidden files", async () => {
    writeFile(root, ".env", "SECRET=hunter2\n");
    const search = searchFilesTool({ root });
    const out = await runTool(search, { pattern: "SECRET", glob: ".env" });

    expect(out).toMatch(/hidden/i);
    expect(out).toMatch(/deliberate/i);
    expect(out).toMatch(/no glob overrides it/i);
    expect(out).not.toMatch(/read_lines/);
    // Still honest about what it does NOT know.
    expect(out).toMatch(/NOT evidence/i);
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
    expect(out).toMatch(/excluded by an ignore rule/i);
    expect(out).toMatch(/nothing was searched/i);
    expect(out).toMatch(/read_lines/);
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
    expect(out).toMatch(/deliberate/i);
    expect(out).not.toMatch(/read_lines/);
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

    // `**/config` genuinely DOES match .git/config, so "matched no files" would
    // itself be false. Name the real reason it went unsearched, and tell the
    // agent no project file matches — never call git plumbing their ignored source.
    expect(out).toMatch(/inside \.git\//i);
    expect(out).toMatch(/if you meant a project file, none matches/i);
    expect(out).not.toMatch(/excluded by an ignore rule/i);
    expect(out).not.toMatch(/is hidden/i);
  });

  // ...but when the caller DELIBERATELY globs into .git/ (reading .git/config
  // for the remote URL is routine), our own guard is what blinded us. Blaming
  // their glob would be the same lie in a new place.
  it("admits its own .git guard when the caller deliberately globs .git/", async () => {
    writeFile(root, ".git/config", '[remote "origin"]\n\turl = git@github.com:x/y.git\n');
    const search = searchFilesTool({ root });
    const out = await runTool(search, { pattern: "url", glob: ".git/**" });

    expect(out).toMatch(/inside \.git\//i);
    expect(out).toMatch(/not a mistake in your glob/i);
    expect(out).not.toMatch(/matched no files/i);
    expect(out).not.toMatch(/bare directory name/i);
  });

  // The intersection — hidden AND ignored — is the common case in the wild
  // (.env in .gitignore, .venv/, .next/, .turbo/), and it is exactly the case a
  // one-at-a-time ladder misattributes.
  it("names both mechanisms for a file that is hidden AND ignored", async () => {
    writeFile(root, ".cache/secret.txt", "TOKEN=abc123\n");
    writeFile(root, ".ignore", "ignored/\n.cache/\n");
    const search = searchFilesTool({ root });
    const out = await runTool(search, { pattern: "TOKEN", glob: ".cache/**" });

    expect(out).not.toBe("No matches.");
    expect(out).toMatch(/BOTH hidden and excluded by an ignore rule/i);
    expect(out).not.toMatch(/read_lines/);
    expect(out).not.toMatch(/matched no files/i);
  });

  // A glob can span BOTH mechanisms: one match hidden, another merely ignored.
  // Returning on the first probe to fire would claim "EVERY file matching X is
  // hidden" — false — and would never mention the ignored file at all, leaving
  // the agent to answer confidently without knowing it exists.
  it("names both mechanisms when the glob spans a hidden file AND an ignored one", async () => {
    writeFile(root, ".config/a.txt", "TOKEN here\n"); // hidden, NOT ignored
    writeFile(root, "dist/b.txt", "TOKEN here\n"); // ignored, NOT hidden
    writeFile(root, ".ignore", "ignored/\ndist/\n");
    const search = searchFilesTool({ root });
    const out = await runTool(search, { pattern: "TOKEN", glob: "**/*.txt" });

    expect(out).not.toBe("No matches.");
    // Never "every file … is hidden" — dist/b.txt is not hidden.
    expect(out).toMatch(/some files.*are hidden/i);
    expect(out).toMatch(/others are excluded by an ignore rule/i);
    expect(out).toMatch(/NOT evidence/i);
    // The ignored one is readable and worth naming; the hidden one stays withheld.
    expect(out).toMatch(/read_lines/);
  });
});
