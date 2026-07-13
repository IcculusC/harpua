import fs from "node:fs";
import path from "node:path";

import { SkillRegistry } from "../skills/skill-registry";
import { renderSkillMenu } from "../skills/render-skill-menu";
import { makeTmpDir, removeTmpDir, writeFile } from "./tmp-tree";

const SKILL = (name: string, description: string, body = "Follow these steps.") =>
  `---\nname: ${name}\ndescription: ${description}\n---\n\n# ${name}\n\n${body}\n`;

describe("SkillRegistry", () => {
  let root: string;
  const warnings: string[] = [];
  const onWarn = (msg: string) => warnings.push(msg);

  beforeEach(() => {
    root = makeTmpDir("skills-");
    warnings.length = 0;
  });
  afterEach(() => removeTmpDir(root));

  it("discovers skills, sorted by name, and serves bodies", () => {
    writeFile(root, "zeta/SKILL.md", SKILL("zeta", "Last thing"));
    writeFile(root, "alpha/SKILL.md", SKILL("alpha", "First thing"));
    const reg = new SkillRegistry(root, { onWarn });

    expect(reg.menu().map((s) => s.name)).toEqual(["alpha", "zeta"]);
    expect(reg.menu()[0].description).toBe("First thing");
    expect(reg.has("alpha")).toBe(true);
    expect(reg.body("alpha")).toContain("Follow these steps.");
    expect(reg.body("nope")).toBeNull();
    expect(warnings).toEqual([]);
  });

  it("a missing skills dir yields an empty registry, never a crash", () => {
    const reg = new SkillRegistry(path.join(root, "does-not-exist"), { onWarn });
    expect(reg.menu()).toEqual([]);
  });

  it("skips malformed entries with a warning: no frontmatter, name/dir mismatch, empty description, oversized body", () => {
    writeFile(root, "good/SKILL.md", SKILL("good", "Fine"));
    writeFile(root, "nofront/SKILL.md", "# just markdown\n");
    writeFile(root, "mismatch/SKILL.md", SKILL("other-name", "Desc"));
    writeFile(root, "nodesc/SKILL.md", "---\nname: nodesc\ndescription:\n---\nbody\n");
    writeFile(root, "huge/SKILL.md", SKILL("huge", "Big", "x".repeat(20_000)));
    const reg = new SkillRegistry(root, { onWarn });

    expect(reg.menu().map((s) => s.name)).toEqual(["good"]);
    expect(warnings.length).toBe(4);
  });

  it("a symlinked SKILL.md never leaks its target", () => {
    const secret = writeFile(root, "outside/secret.md", SKILL("sneaky", "TOP SECRET"));
    fs.mkdirSync(path.join(root, "skills-dir", "sneaky"), { recursive: true });
    fs.symlinkSync(secret, path.join(root, "skills-dir", "sneaky", "SKILL.md"));
    const reg = new SkillRegistry(path.join(root, "skills-dir"), { onWarn });

    expect(reg.menu()).toEqual([]);
    expect(reg.body("sneaky")).toBeNull();
    expect(warnings.length).toBe(1);
    expect(warnings[0]).not.toContain("TOP SECRET");
  });

  it("lists references with line counts, dir-relative and sorted, excluding SKILL.md", () => {
    writeFile(root, "kicad/SKILL.md", SKILL("kicad", "Board design"));
    writeFile(root, "kicad/references/format.md", "a\nb\nc\n");
    writeFile(root, "kicad/references/deep/notes.md", "one\ntwo"); // no trailing newline
    const reg = new SkillRegistry(root, { onWarn });

    expect(reg.references("kicad")).toEqual([
      { path: "references/deep/notes.md", lines: 2 },
      { path: "references/format.md", lines: 3 },
    ]);
    expect(reg.references("nope")).toEqual([]);
  });

  it("rescan() reports the diff and whether the on-wire menu changed", () => {
    writeFile(root, "alpha/SKILL.md", SKILL("alpha", "First"));
    const reg = new SkillRegistry(root, { onWarn });
    expect(reg.menu()).toHaveLength(1);

    // No change on disk -> changed: false.
    expect(reg.rescan()).toEqual({ count: 1, names: ["alpha"], skipped: 0, changed: false });

    // A new skill lands mid-session (npx skills add) -> visible after rescan.
    writeFile(root, "beta/SKILL.md", SKILL("beta", "Second"));
    writeFile(root, "broken/SKILL.md", "no frontmatter");
    const result = reg.rescan();
    expect(result).toEqual({ count: 2, names: ["alpha", "beta"], skipped: 1, changed: true });
    expect(reg.has("beta")).toBe(true);
  });
});

describe("renderSkillMenu", () => {
  it("renders the system-prompt TOC, and empty input renders to an empty string", () => {
    expect(renderSkillMenu([])).toBe("");
    const menu = renderSkillMenu([
      { name: "kicad", description: "Board design", dir: "/x" },
      { name: "zeta", description: "Last", dir: "/y" },
    ]);
    expect(menu).toContain("SKILLS");
    expect(menu).toContain("use_skill");
    expect(menu).toContain("- kicad: Board design");
    expect(menu).toContain("- zeta: Last");
  });
});

describe("review-pinned registry edges", () => {
  it("menu() hands out a copy — caller mutation can't corrupt order or fake a changed signal", () => {
    const root = makeTmpDir("skills-copy-");
    try {
      writeFile(root, "alpha/SKILL.md", "---\nname: alpha\ndescription: A\n---\nx\n");
      writeFile(root, "zeta/SKILL.md", "---\nname: zeta\ndescription: Z\n---\nx\n");
      const reg = new SkillRegistry(root, { onWarn: () => {} });
      reg.menu().reverse(); // hostile caller
      expect(reg.menu().map((s) => s.name)).toEqual(["alpha", "zeta"]);
      expect(reg.rescan().changed).toBe(false);
    } finally {
      removeTmpDir(root);
    }
  });

  it("a description-only change flips rescan().changed (same names, new menu bytes)", () => {
    const root = makeTmpDir("skills-desc-");
    try {
      writeFile(root, "alpha/SKILL.md", "---\nname: alpha\ndescription: Old\n---\nx\n");
      const reg = new SkillRegistry(root, { onWarn: () => {} });
      writeFile(root, "alpha/SKILL.md", "---\nname: alpha\ndescription: New\n---\nx\n");
      const result = reg.rescan();
      expect(result.names).toEqual(["alpha"]);
      expect(result.changed).toBe(true);
    } finally {
      removeTmpDir(root);
    }
  });
});
