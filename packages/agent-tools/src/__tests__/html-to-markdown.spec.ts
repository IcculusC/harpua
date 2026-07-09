import { htmlToMarkdown, decodeEntities } from "../web-research/html-to-markdown";

describe("decodeEntities", () => {
  it("decodes named, decimal, and hex entities and leaves unknowns alone", () => {
    expect(decodeEntities("a &amp; b &lt;c&gt; &#176; &#x2126; &bogus;")).toBe(
      "a & b <c> ° Ω &bogus;",
    );
  });
});

describe("htmlToMarkdown", () => {
  it("captures the title and converts headings, paragraphs, links, and lists", () => {
    const html = [
      "<html><head><title>LM317 &amp; Friends</title>",
      "<style>body{color:red}</style><script>alert(1)</script></head>",
      "<body><h1>LM317</h1>",
      "<p>An <a href=\"https://ti.com/lm317\">adjustable regulator</a>.</p>",
      "<h2>Specs</h2>",
      "<ul><li>Dropout: 1.5 V</li><li>Package: TO-220</li></ul>",
      "</body></html>",
    ].join("\n");
    const { title, markdown } = htmlToMarkdown(html);
    expect(title).toBe("LM317 & Friends");
    expect(markdown).toContain("# LM317");
    expect(markdown).toContain("[adjustable regulator](https://ti.com/lm317)");
    expect(markdown).toContain("## Specs");
    expect(markdown).toContain("- Dropout: 1.5 V");
    expect(markdown).toContain("- Package: TO-220");
    expect(markdown).not.toContain("alert(1)");
    expect(markdown).not.toContain("color:red");
  });

  it("protects pre blocks so code angle brackets survive tag stripping", () => {
    const html =
      "<body><pre><code>if (a &lt; b && b > c) {}</code></pre><p>after</p></body>";
    const { markdown } = htmlToMarkdown(html);
    expect(markdown).toContain("```");
    expect(markdown).toContain("if (a < b && b > c) {}");
    expect(markdown).toContain("after");
  });

  it("converts inline code and best-effort tables", () => {
    const html = [
      "<p>Use <code>add_spec</code>.</p>",
      "<table><tr><th>Key</th><th>Value</th></tr>",
      "<tr><td>Dropout</td><td>1.5 V</td></tr></table>",
    ].join("");
    const { markdown } = htmlToMarkdown(html);
    expect(markdown).toContain("`add_spec`");
    expect(markdown).toContain("| Key | Value |");
    expect(markdown).toContain("| Dropout | 1.5 V |");
  });

  it("collapses blank-line runs and trims the result", () => {
    const html = "<div><p>a</p></div>\n\n\n<div><div><p>b</p></div></div>";
    const { markdown } = htmlToMarkdown(html);
    expect(markdown).toBe("a\n\nb");
  });

  it("handles pathological input without throwing", () => {
    expect(htmlToMarkdown("").markdown).toBe("");
    expect(htmlToMarkdown("<h1>unclosed").markdown).toContain("# unclosed");
    expect(htmlToMarkdown("plain text, no tags").markdown).toBe(
      "plain text, no tags",
    );
    expect(htmlToMarkdown("<body><h1></h1></body>").title).toBeUndefined();
  });

  it("keeps nested inline tags inside headings", () => {
    expect(htmlToMarkdown("<h1>Some <b>Bold</b> Text</h1>").markdown).toBe(
      "# Some Bold Text",
    );
    expect(
      htmlToMarkdown("<h2><strong>Warning</strong> Notice</h2>").markdown,
    ).toBe("## Warning Notice");
  });
});
