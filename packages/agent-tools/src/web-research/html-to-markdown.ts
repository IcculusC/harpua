/*
 * Dependency-free HTML → markdown extraction. The goal is ripgrep-able text
 * for agents (headings, lists, links, code, best-effort tables) — NOT
 * rendering fidelity. Upgradeable later without changing the tool contract.
 */

/** The named entities worth decoding without a library (plus numeric forms). */
const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  mdash: "—",
  ndash: "–",
  hellip: "…",
  copy: "©",
  reg: "®",
  trade: "™",
  deg: "°",
  micro: "µ",
  plusmn: "±",
  times: "×",
  divide: "÷",
};

function safeFromCodePoint(code: number): string {
  try {
    // Normalize ohm sign (U+2126) to omega (U+03A9) for HTML compatibility
    if (code === 0x2126) {
      code = 0x03a9;
    }
    return String.fromCodePoint(code);
  } catch {
    return "";
  }
}

/** Decode numeric (dec/hex) and common named HTML entities; unknowns pass through. */
export function decodeEntities(text: string): string {
  return text
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) =>
      safeFromCodePoint(parseInt(hex, 16)),
    )
    .replace(/&#(\d+);/g, (_, dec: string) =>
      safeFromCodePoint(parseInt(dec, 10)),
    )
    .replace(
      /&([a-z]+);/gi,
      (match, name: string) => NAMED_ENTITIES[name.toLowerCase()] ?? match,
    );
}

/** Strip any tags remaining in an inline fragment and decode its entities. */
function inlineText(fragment: string): string {
  return decodeEntities(fragment.replace(/<[^>]*>/g, "")).replace(/\s+/g, " ").trim();
}

export interface HtmlToMarkdownResult {
  /** Decoded <title> text, when present and non-empty. */
  title?: string;
  /** The extracted markdown (trimmed; blank-line runs collapsed). */
  markdown: string;
}

/**
 * Convert an HTML document (or fragment) to searchable markdown. Drops
 * script/style/noscript/head/comments, protects `<pre>` content from tag
 * stripping via placeholders, converts headings/lists/links/code/tables,
 * decodes entities, and collapses whitespace.
 */
export function htmlToMarkdown(html: string): HtmlToMarkdownResult {
  const titleMatch = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  const titleText = titleMatch ? inlineText(titleMatch[1]!) : "";
  const title = titleText.length > 0 ? titleText : undefined;

  let work = html
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<head[^>]*>[\s\S]*?<\/head>/gi, "")
    .replace(/<(script|style|noscript)[^>]*>[\s\S]*?<\/\1>/gi, "");

  // Protect <pre> blocks: their content may contain literal < and > that the
  // global tag-strip below would otherwise eat.
  const preBlocks: string[] = [];
  work = work.replace(/<pre[^>]*>([\s\S]*?)<\/pre>/gi, (_, inner: string) => {
    const text = decodeEntities(inner.replace(/<[^>]*>/g, "")).replace(
      /^\n+|\n+$/g,
      "",
    );
    preBlocks.push("```\n" + text + "\n```");
    return `\n\n@@PRE${preBlocks.length - 1}@@\n\n`;
  });

  work = work
    // Inline code before generic stripping so backticks wrap the content.
    .replace(/<code[^>]*>([\s\S]*?)<\/code>/gi, (_, inner: string) => {
      const text = inlineText(inner);
      return text.length > 0 ? `\`${text}\`` : "";
    })
    // Links: [text](href). Ignore anchors without an href.
    .replace(
      /<a\s[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi,
      (_, href: string, inner: string) => {
        const text = inlineText(inner);
        return text.length > 0 ? `[${text}](${href})` : "";
      },
    )
    // Headings h1–h6. Allow unclosed tags for pathological input.
    .replace(
      /<h([1-6])[^>]*>([\s\S]*?)(?:<\/h\1>|(?=<)|$)/gi,
      (match, level: string, inner: string) => {
        const text = inlineText(inner);
        return text.length > 0
          ? `\n\n${"#".repeat(Number(level))} ${text}\n\n`
          : "\n\n";
      },
    )
    // List items become bullets (ol and ul alike; nesting flattens).
    .replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, (_, inner: string) => {
      const text = inlineText(inner);
      return text.length > 0 ? `\n- ${text}` : "";
    })
    // Best-effort tables: each row becomes a pipe row.
    .replace(/<tr[^>]*>([\s\S]*?)<\/tr>/gi, (_, inner: string) => {
      const cells = [...inner.matchAll(/<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/gi)].map(
        (m) => inlineText(m[1]!),
      );
      return cells.length > 0 ? `\n| ${cells.join(" | ")} |` : "";
    })
    // Paragraph-ish boundaries become blank lines; <br> a newline.
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/?(p|div|section|article|table|ul|ol|blockquote|tbody|thead|main|header|footer|nav|aside|figure)[^>]*>/gi, "\n\n");

  // Strip every remaining tag, decode entities, restore protected pre blocks.
  work = decodeEntities(work.replace(/<[^>]*>/g, ""));
  work = work.replace(/@@PRE(\d+)@@/g, (_, i: string) => preBlocks[Number(i)]!);

  // Normalize whitespace: trim line ends, collapse 3+ newlines to 2, trim.
  const markdown = work
    .split("\n")
    .map((line) => line.replace(/[ \t]+$/g, "").replace(/^[ \t]+/g, ""))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return { title, markdown };
}
