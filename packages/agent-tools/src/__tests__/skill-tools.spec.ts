import { SkillRegistry } from "../skills/skill-registry";
import { useSkillTool } from "../skills/use-skill";
import { readSkillFileTool } from "../skills/read-skill-file";
import { makeTmpDir, removeTmpDir, writeFile, numberedLines, runTool } from "./tmp-tree";

const SKILL = (name: string, description: string, body: string) =>
  `---\nname: ${name}\ndescription: ${description}\n---\n\n${body}\n`;

describe("skill tools", () => {
  let root: string;
  let registry: SkillRegistry;

  beforeEach(() => {
    root = makeTmpDir("skill-tools-");
    writeFile(root, "kicad/SKILL.md", SKILL("kicad", "Board design", "Read references/grammar.md when asked to."));
    writeFile(root, "kicad/references/grammar.md", numberedLines(30));
    writeFile(root, "kicad/secret-neighbor.txt", "not a reference? yes it is");
    writeFile(root, "solo/SKILL.md", SKILL("solo", "No references", "Just do it."));
    writeFile(root, "outside-secret.txt", "TOP SECRET");
    registry = new SkillRegistry(root, { onWarn: () => {} });
  });
  afterEach(() => removeTmpDir(root));

  describe("use_skill", () => {
    it("returns the body and LISTS references with line counts without reading them", async () => {
      const out = await runTool(useSkillTool({ registry }), { name: "kicad" });
      expect(out).toContain("Read references/grammar.md when asked to.");
      expect(out).toContain("references/grammar.md (30 lines)");
      expect(out).toContain("read_skill_file");
      expect(out).not.toContain("line01"); // reference CONTENT not loaded
    });

    it("a skill with no references returns just the body", async () => {
      const out = await runTool(useSkillTool({ registry }), { name: "solo" });
      expect(out).toContain("Just do it.");
      expect(out).not.toContain("Reference files");
    });

    it("an unknown name returns the menu, not an error", async () => {
      const out = await runTool(useSkillTool({ registry }), { name: "nope" });
      expect(out).toContain('No skill named "nope"');
      expect(out).toContain("kicad: Board design");
      expect(out).toContain("solo: No references");
    });
  });

  describe("read_skill_file", () => {
    it("reads a reference with line numbers and honors startLine/endLine", async () => {
      const tool = readSkillFileTool({ registry });
      const all = await runTool(tool, { skill: "kicad", path: "references/grammar.md" });
      expect(all).toContain("line01");
      expect(all).toContain("line30");

      const slice = await runTool(tool, {
        skill: "kicad",
        path: "references/grammar.md",
        startLine: 5,
        endLine: 7,
      });
      expect(slice).toContain("line05");
      expect(slice).toContain("line07");
      expect(slice).not.toContain("line04");
      expect(slice).not.toContain("line08");
    });

    it("the jail is PER SKILL: ../ traversal to a sibling skill or outside is refused politely", async () => {
      const tool = readSkillFileTool({ registry });
      const sibling = await runTool(tool, { skill: "kicad", path: "../solo/SKILL.md" });
      expect(sibling).not.toContain("Just do it.");
      expect(sibling).toMatch(/relative|inside|Refused/i);

      const outside = await runTool(tool, { skill: "kicad", path: "../outside-secret.txt" });
      expect(outside).not.toContain("TOP SECRET");
    });

    it("an unknown skill returns the menu; a missing file names the path", async () => {
      const tool = readSkillFileTool({ registry });
      expect(await runTool(tool, { skill: "nope", path: "x.md" })).toContain('No skill named "nope"');
      expect(await runTool(tool, { skill: "kicad", path: "references/gone.md" })).toContain("gone.md");
    });

    it("caps a single read and says how to page", async () => {
      writeFile(root, "kicad/references/big.md", numberedLines(3000));
      registry.rescan();
      const out = await runTool(readSkillFileTool({ registry }), {
        skill: "kicad",
        path: "references/big.md",
      });
      expect(out).toContain("line01");
      expect(out).not.toContain("line2999");
      expect(out).toMatch(/startLine/);
    });
  });
});

describe("review-pinned edges", () => {
  let root: string;
  let registry: SkillRegistry;
  beforeEach(() => {
    root = makeTmpDir("skill-edges-");
    writeFile(root, "kicad/SKILL.md", `---\nname: kicad\ndescription: Board design\n---\nBody.\n`);
    writeFile(root, "kicad/.env", "SECRET=1\n");
    writeFile(root, "kicad/references/one-line.md", "x".repeat(200_000));
    registry = new SkillRegistry(root, { onWarn: () => {} });
  });
  afterEach(() => removeTmpDir(root));

  it("secret-named files are neither listed by use_skill nor misdiagnosed by read_skill_file", async () => {
    const listing = await runTool(useSkillTool({ registry }), { name: "kicad" });
    expect(listing).not.toContain(".env"); // never advertised (existence + line count is a leak)

    const read = await runTool(readSkillFileTool({ registry }), { skill: "kicad", path: ".env" });
    expect(read).not.toContain("SECRET=1");
    expect(read).toMatch(/secret|protected/i); // the real reason, not the traversal message
    expect(read).not.toContain('no leading "/"');
  });

  it("a skill dir deleted mid-session refuses politely instead of throwing", async () => {
    removeTmpDir(`${root}/kicad`);
    const out = await runTool(readSkillFileTool({ registry }), { skill: "kicad", path: "SKILL.md" });
    expect(out).toMatch(/no longer|gone|missing|No file/i);
  });

  it("a single line over the byte cap is hard-truncated, never an empty self-referential loop", async () => {
    const out = await runTool(readSkillFileTool({ registry }), {
      skill: "kicad",
      path: "references/one-line.md",
    });
    expect(out).toContain("xxxx"); // real content emitted
    expect(out).toMatch(/truncated/i);
    expect(out).not.toContain("lines 1–0"); // no nonsense header
  });
});
