import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { linkSkills } from "../harpua-skills";

const AGENT_DIRS = [".claude/skills", ".agents/skills"] as const;

/** Create a fake installed @harpua package that ships a skill directory. */
function seedSkill(cwd: string, pkg: string, skill: string): string {
  const skillDir = path.join(cwd, "node_modules", "@harpua", pkg, "skills", skill);
  fs.mkdirSync(skillDir, { recursive: true });
  fs.writeFileSync(path.join(skillDir, "SKILL.md"), `# ${skill}\n`);
  return skillDir;
}

/** Absolute path a link at `<cwd>/<agentDir>/<skill>` should resolve to. */
function linkPathFor(cwd: string, agentDir: string, skill: string): string {
  return path.join(cwd, agentDir, skill);
}

describe("linkSkills", () => {
  let cwd: string;

  beforeEach(() => {
    cwd = fs.mkdtempSync(path.join(os.tmpdir(), "harpua-skills-"));
  });

  afterEach(() => {
    fs.rmSync(cwd, { recursive: true, force: true });
  });

  it("creates a link in both agent dirs pointing at the skill (fresh)", () => {
    seedSkill(cwd, "langgraph", "graph-operations");

    const result = linkSkills({ cwd });

    expect(result.skills).toEqual(["graph-operations"]);
    expect(result.linkedCount).toBe(1);
    for (const agentDir of AGENT_DIRS) {
      const link = linkPathFor(cwd, agentDir, "graph-operations");
      // Symlink resolves through to the shipped SKILL.md.
      expect(fs.lstatSync(link).isSymbolicLink()).toBe(true);
      expect(fs.existsSync(path.join(link, "SKILL.md"))).toBe(true);
      // Target is stored RELATIVE (portable when the project moves).
      expect(path.isAbsolute(fs.readlinkSync(link))).toBe(false);
    }
    const created = result.outcomes.filter((o) => o.action === "created");
    expect(created).toHaveLength(2);
    expect(result.summary).toContain("linked 1 skill into");
    expect(result.summary).toContain("graph-operations");
  });

  it("is idempotent: a correct existing link is skipped silently", () => {
    seedSkill(cwd, "langgraph", "graph-operations");
    linkSkills({ cwd });

    const result = linkSkills({ cwd });

    expect(result.outcomes.every((o) => o.action === "skipped")).toBe(true);
    expect(result.messages).toEqual([]);
    expect(result.linkedCount).toBe(1);
    for (const agentDir of AGENT_DIRS) {
      const link = linkPathFor(cwd, agentDir, "graph-operations");
      expect(fs.existsSync(path.join(link, "SKILL.md"))).toBe(true);
    }
  });

  it("replaces a symlink that points at the wrong target", () => {
    seedSkill(cwd, "langgraph", "graph-operations");
    const link = linkPathFor(cwd, ".claude/skills", "graph-operations");
    fs.mkdirSync(path.dirname(link), { recursive: true });
    fs.symlinkSync("/nonexistent/elsewhere", link);

    const result = linkSkills({ cwd });

    const replaced = result.outcomes.filter((o) => o.action === "replaced");
    expect(replaced).toHaveLength(1);
    expect(replaced[0].agentDir).toBe(".claude/skills");
    // Now resolves correctly.
    expect(fs.existsSync(path.join(link, "SKILL.md"))).toBe(true);
    expect(result.messages.some((m) => m.includes("replaced"))).toBe(true);
  });

  it("does NOT clobber a real directory; warns and continues", () => {
    seedSkill(cwd, "langgraph", "graph-operations");
    const realDir = linkPathFor(cwd, ".claude/skills", "graph-operations");
    fs.mkdirSync(realDir, { recursive: true });
    fs.writeFileSync(path.join(realDir, "user-notes.md"), "mine\n");

    const result = linkSkills({ cwd });

    // Real dir untouched.
    expect(fs.lstatSync(realDir).isSymbolicLink()).toBe(false);
    expect(fs.existsSync(path.join(realDir, "user-notes.md"))).toBe(true);
    const warned = result.outcomes.filter((o) => o.action === "warned");
    expect(warned).toHaveLength(1);
    expect(warned[0].agentDir).toBe(".claude/skills");
    expect(result.warnings.some((w) => w.includes("graph-operations"))).toBe(true);
    // The other agent dir still got linked.
    const other = linkPathFor(cwd, ".agents/skills", "graph-operations");
    expect(fs.lstatSync(other).isSymbolicLink()).toBe(true);
  });

  it("reports zero skills gracefully and exits cleanly (no @harpua packages)", () => {
    fs.mkdirSync(path.join(cwd, "node_modules"), { recursive: true });

    const result = linkSkills({ cwd });

    expect(result.skills).toEqual([]);
    expect(result.linkedCount).toBe(0);
    expect(result.outcomes).toEqual([]);
    expect(result.summary).toMatch(/no @harpua skills/i);
    // Did not create agent dirs when there was nothing to link.
    expect(fs.existsSync(path.join(cwd, ".claude"))).toBe(false);
  });

  it("discovers skills across multiple @harpua packages (name not hardcoded)", () => {
    seedSkill(cwd, "langgraph", "graph-operations");
    seedSkill(cwd, "widgets", "widget-authoring");

    const result = linkSkills({ cwd });

    expect(result.skills.sort()).toEqual(["graph-operations", "widget-authoring"]);
    expect(result.linkedCount).toBe(2);
    for (const skill of ["graph-operations", "widget-authoring"]) {
      for (const agentDir of AGENT_DIRS) {
        const link = linkPathFor(cwd, agentDir, skill);
        expect(fs.existsSync(path.join(link, "SKILL.md"))).toBe(true);
      }
    }
  });

  it("ignores directories under skills/ that lack a SKILL.md", () => {
    seedSkill(cwd, "langgraph", "graph-operations");
    fs.mkdirSync(path.join(cwd, "node_modules", "@harpua", "langgraph", "skills", "not-a-skill"), {
      recursive: true,
    });

    const result = linkSkills({ cwd });

    expect(result.skills).toEqual(["graph-operations"]);
  });
});
