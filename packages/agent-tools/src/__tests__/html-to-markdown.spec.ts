import { htmlToMarkdown } from "../web-research/html-to-markdown";

describe("htmlToMarkdown", () => {
  it("captures the title, decoding entities, separately from the body", () => {
    const html = [
      "<html><head><title>LM317 &amp; Friends</title>",
      "<style>body{color:red}</style><script>alert(1)</script></head>",
      "<body><h1>LM317</h1>",
      '<p>An <a href="https://ti.com/lm317">adjustable regulator</a>.</p>',
      "<h2>Specs</h2>",
      "<ul><li>Dropout: 1.5 V</li><li>Package: TO-220</li></ul>",
      "</body></html>",
    ].join("\n");
    const { title, markdown } = htmlToMarkdown(html);
    expect(title).toBe("LM317 & Friends");
    expect(markdown).toContain("# LM317");
    expect(markdown).toContain("[adjustable regulator](https://ti.com/lm317)");
    expect(markdown).toContain("## Specs");
    expect(markdown).toContain("Dropout: 1.5 V");
    expect(markdown).toContain("Package: TO-220");
    expect(markdown).not.toContain("alert(1)");
    expect(markdown).not.toContain("color:red");
    // The title tag's own text must not leak into the body markdown.
    expect(markdown).not.toContain("LM317 & Friends");
  });

  it("returns title: undefined when there is no non-empty <title>", () => {
    expect(htmlToMarkdown("").title).toBeUndefined();
    expect(htmlToMarkdown("<body><h1></h1></body>").title).toBeUndefined();
    expect(htmlToMarkdown("<body><h1>Hi</h1></body>").title).toBeUndefined();
  });

  it("preserves code blocks, including angle brackets, as fenced markdown", () => {
    const html =
      "<body><pre><code>if (a &lt; b && b > c) {}</code></pre><p>after</p></body>";
    const { markdown } = htmlToMarkdown(html);
    expect(markdown).toContain("```");
    expect(markdown).toContain("if (a < b && b > c) {}");
    expect(markdown).toContain("after");
  });

  it("converts inline code and tables to GFM pipe tables", () => {
    const html = [
      "<p>Use <code>add_spec</code>.</p>",
      "<table><tr><th>Key</th><th>Value</th></tr>",
      "<tr><td>Dropout</td><td>1.5 V</td></tr></table>",
    ].join("");
    const { markdown } = htmlToMarkdown(html);
    expect(markdown).toContain("`add_spec`");
    // GFM table: a header row, a separator row, then data rows — all pipes.
    const rows = markdown.split("\n").filter((line) => line.trim().startsWith("|"));
    expect(rows.length).toBeGreaterThanOrEqual(3);
    expect(rows[0]).toMatch(/\|\s*Key\s*\|\s*Value\s*\|/);
    expect(rows[1]).toMatch(/^\s*\|[\s-]*\|[\s-]*\|\s*$/);
    expect(rows.some((r) => /Dropout/.test(r) && /1\.5 V/.test(r))).toBe(true);
  });

  it("handles pathological input without throwing", () => {
    expect(htmlToMarkdown("").markdown).toBe("");
    expect(htmlToMarkdown("<h1>unclosed").markdown).toContain("# unclosed");
    expect(htmlToMarkdown("plain text, no tags").markdown).toBe(
      "plain text, no tags",
    );
  });

  it("keeps nested inline tags inside headings", () => {
    expect(htmlToMarkdown("<h1>Some <b>Bold</b> Text</h1>").markdown).toContain(
      "Some **Bold** Text",
    );
    expect(
      htmlToMarkdown("<h2><strong>Warning</strong> Notice</h2>").markdown,
    ).toContain("**Warning** Notice");
  });
});
