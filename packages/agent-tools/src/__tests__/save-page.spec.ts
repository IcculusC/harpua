import fs from "node:fs";
import path from "node:path";

import { pageSlug, savePage } from "../web-research/save-page";
import { makeTmpDir, removeTmpDir } from "./tmp-tree";

describe("pageSlug", () => {
  it("slugs the title and appends a stable URL hash", () => {
    const url = new URL("https://ti.com/product/LM317");
    const a = pageSlug("LM317 3-Terminal Regulator!", url);
    const b = pageSlug("LM317 3-Terminal Regulator!", url);
    expect(a).toBe(b);
    expect(a).toMatch(/^lm317-3-terminal-regulator-[0-9a-f]{8}$/);
  });

  it("falls back to host+path when there is no title, and never collides across URLs", () => {
    const a = pageSlug(undefined, new URL("https://ti.com/a"));
    const b = pageSlug(undefined, new URL("https://ti.com/b"));
    expect(a).toMatch(/^ti-com-a-[0-9a-f]{8}$/);
    expect(a).not.toBe(b);
  });

  it("gives same-title pages from different URLs distinct slugs", () => {
    const a = pageSlug("Datasheet", new URL("https://x.com/1"));
    const b = pageSlug("Datasheet", new URL("https://x.com/2"));
    expect(a).not.toBe(b);
  });

  it("never produces path separators or dots from hostile titles", () => {
    const slug = pageSlug("../../etc/passwd", new URL("https://x.com/p"));
    expect(slug).not.toContain("/");
    expect(slug).not.toContain("\\");
    expect(slug).not.toContain("..");
  });
});

describe("savePage", () => {
  let dir: string;
  beforeEach(() => (dir = makeTmpDir()));
  afterEach(() => removeTmpDir(dir));

  it("creates the directory, writes frontmatter + markdown, returns the path", () => {
    const target = path.join(dir, "nested", "sources");
    const saved = savePage({
      dir: target,
      url: new URL("https://ti.com/lm317"),
      title: 'LM317 "quoted"',
      markdown: "# LM317\n\nBody.",
      fetched: "2026-07-08",
    });
    const content = fs.readFileSync(saved, "utf8");
    expect(saved.startsWith(target)).toBe(true);
    expect(content).toContain("---");
    expect(content).toContain("url: https://ti.com/lm317");
    expect(content).toContain('title: "LM317 \\"quoted\\""');
    expect(content).toContain("fetched: 2026-07-08");
    expect(content).toContain("# LM317");
    expect(content.endsWith("\n")).toBe(true);
  });

  it("overwrites on re-save of the same URL (refresh, not duplicate)", () => {
    const url = new URL("https://ti.com/lm317");
    const first = savePage({ dir, url, title: "T", markdown: "old", fetched: "2026-07-07" });
    const second = savePage({ dir, url, title: "T", markdown: "new", fetched: "2026-07-08" });
    expect(second).toBe(first);
    expect(fs.readdirSync(dir)).toHaveLength(1);
    expect(fs.readFileSync(first, "utf8")).toContain("new");
  });

  it("omits the title line when there is no title", () => {
    const saved = savePage({
      dir,
      url: new URL("https://x.com/p"),
      markdown: "body",
      fetched: "2026-07-08",
    });
    expect(fs.readFileSync(saved, "utf8")).not.toContain("title:");
  });
});
