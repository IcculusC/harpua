/*
 * HTML → markdown extraction for agents (headings, lists, links, code,
 * GFM tables) via node-html-markdown. Upgradeable later without changing
 * the tool contract.
 */
import { NodeHtmlMarkdown } from "node-html-markdown";

export interface HtmlToMarkdownResult {
  /** Decoded <title> text, when present and non-empty. */
  title?: string;
  /** The extracted markdown, as produced by node-html-markdown. */
  markdown: string;
}

/**
 * Convert an HTML document (or fragment) to searchable markdown.
 * node-html-markdown handles script/style/comment removal, entity
 * decoding, and GFM table conversion. It does not surface the document
 * title, so `<title>` is pulled out with a small regex and run through
 * the same translator to decode entities and trim it.
 */
export function htmlToMarkdown(html: string): HtmlToMarkdownResult {
  const titleMatch = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  const titleText = titleMatch ? NodeHtmlMarkdown.translate(titleMatch[1]!).trim() : "";
  const title = titleText.length > 0 ? titleText : undefined;

  const markdown = NodeHtmlMarkdown.translate(html);

  return { title, markdown };
}
