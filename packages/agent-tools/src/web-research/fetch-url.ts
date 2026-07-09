import { tool } from "@langchain/core/tools";
import type { StructuredToolInterface } from "@langchain/core/tools";
import type { RunnableConfig } from "@langchain/core/runnables";
import { z } from "zod";

import {
  resolveFetchUrlOptions,
  type FetchUrlToolOptions,
} from "./options";
import { errorMessage } from "./errors";
import { fetchGuarded, readTextCapped } from "./fetch-guarded";
import { htmlToMarkdown } from "./html-to-markdown";
import { savePage } from "./save-page";

const DESCRIPTION =
  "Fetch a web page and save it locally as markdown so it can be searched " +
  "and read. Give it a URL (from web_search results or the user); it " +
  "converts HTML to markdown, saves the file, and tells you the saved path. " +
  "Then use search_files to find terms in it and read_lines to read it. " +
  "HTML and plain-text pages only — PDFs and other binary types are refused. " +
  "SECURITY: fetches whatever URL is supplied. Private/loopback addresses are " +
  "refused by default; publicly-deployed apps should still gate it (e.g. " +
  "requireApproval) or front it with an allowlist.";

const fetchUrlInputSchema = z.object({
  url: z.string().min(1).describe("The absolute http(s) URL of the page to fetch."),
});

/**
 * `fetch_url` — fetch an HTML or plain-text page, convert HTML to markdown
 * via the built-in extractor, and save it (with url/title/fetched
 * frontmatter) into `saveDir`. `saveDir` may be a function of the run config
 * so apps can resolve per-thread directories. Never throws: bad schemes,
 * network errors, non-2xx statuses, refused content types, oversize bodies,
 * and filesystem failures all come back as friendly strings.
 *
 * @example
 * ```ts
 * import { fetchUrlTool } from "@harpua/agent-tools";
 *
 * const fetchUrl = fetchUrlTool({ saveDir: "./sources" });
 * ```
 */
export function fetchUrlTool(
  options: FetchUrlToolOptions,
): StructuredToolInterface {
  const opts = resolveFetchUrlOptions(options);

  return tool(
    async ({ url: input }, config?: RunnableConfig) => {
      const guarded = await fetchGuarded("fetch_url", input, {
        allowPrivate: opts.allowPrivate,
        timeoutMs: opts.timeoutMs,
        maxResponseBytes: opts.maxResponseBytes,
        fetchFn: opts.fetchFn,
      });
      if (!guarded.ok) return guarded.error;
      const { finalUrl, contentType, response } = guarded;

      if (contentType.includes("application/pdf")) {
        return (
          `fetch_url: ${finalUrl.toString()} is a PDF — fetch_url only saves ` +
          "HTML and plain-text pages. Use the opt-in fetch_pdf tool for PDFs."
        );
      }
      const isHtml = contentType.includes("text/html");
      const isPlain = contentType.includes("text/plain");
      if (!isHtml && !isPlain) {
        return (
          `fetch_url: unsupported content type "${contentType || "unknown"}" — ` +
          "only text/html and text/plain pages are saved."
        );
      }

      const read = await readTextCapped("fetch_url", response, opts.maxResponseBytes);
      if (!read.ok) return read.error;

      const { title, markdown } = isHtml
        ? htmlToMarkdown(read.text)
        : { title: undefined, markdown: read.text };

      const dir =
        typeof opts.saveDir === "function" ? opts.saveDir(config) : opts.saveDir;
      const fetched = opts.now().toISOString().slice(0, 10);

      // Record where the content actually came from (post-redirect), so the
      // frontmatter URL and the overwrite-keying slug reflect the real source.
      let saved: string;
      try {
        saved = savePage({ dir, url: finalUrl, title, markdown, fetched });
      } catch (err) {
        return `fetch_url: could not save the page (${errorMessage(err)}).`;
      }

      const lineCount = markdown.split("\n").length;
      const label = title ?? `${finalUrl.host}${finalUrl.pathname}`;
      return (
        `Saved "${label}" (${lineCount} lines) to ${saved}.\n` +
        "Search it with search_files or read it with read_lines."
      );
    },
    { name: "fetch_url", description: DESCRIPTION, schema: fetchUrlInputSchema },
  );
}
