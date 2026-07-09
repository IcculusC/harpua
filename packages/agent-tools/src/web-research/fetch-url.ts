import { tool } from "@langchain/core/tools";
import type { StructuredToolInterface } from "@langchain/core/tools";
import type { RunnableConfig } from "@langchain/core/runnables";
import { z } from "zod";

import {
  resolveFetchUrlOptions,
  type FetchUrlToolOptions,
} from "./options";
import { errorMessage } from "./errors";
import { htmlToMarkdown } from "./html-to-markdown";
import { isPrivateAddress } from "./private-address";
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
      let url: URL;
      try {
        url = new URL(input);
      } catch {
        return `fetch_url: "${input}" is not a valid URL.`;
      }
      if (url.protocol !== "http:" && url.protocol !== "https:") {
        return `fetch_url: only http(s) URLs are supported (got "${url.protocol}").`;
      }
      if (!opts.allowPrivate && isPrivateAddress(url.hostname)) {
        return (
          `fetch_url: refusing to fetch the private/loopback address ` +
          `"${url.hostname}" — set allowPrivate: true if this is intentional.`
        );
      }

      let response;
      try {
        response = await opts.fetchFn(url.toString(), {
          signal: AbortSignal.timeout(opts.timeoutMs),
        });
      } catch (err) {
        return `fetch_url: request failed (${errorMessage(err)}).`;
      }

      if (!response.ok) {
        return `fetch_url: ${url.toString()} returned HTTP ${response.status}.`;
      }

      // Redirects are followed by the underlying fetch; re-check where we
      // actually landed so a public URL can't 302 past the private-address
      // guard, and so provenance records the real source.
      let finalUrl = url;
      if (response.url) {
        try {
          finalUrl = new URL(response.url);
        } catch {
          finalUrl = url;
        }
      }
      if (!opts.allowPrivate && finalUrl.hostname !== url.hostname &&
          isPrivateAddress(finalUrl.hostname)) {
        return (
          `fetch_url: ${url.toString()} redirected to the private/loopback ` +
          `address "${finalUrl.hostname}" — refused (set allowPrivate: true ` +
          `if this is intentional).`
        );
      }

      const contentType = (response.headers.get("content-type") ?? "").toLowerCase();
      if (contentType.includes("application/pdf")) {
        return (
          `fetch_url: ${url.toString()} is a PDF — PDFs aren't supported yet; ` +
          "only HTML and plain-text pages can be saved."
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

      // Prefer the declared size so an oversize body is refused before it is
      // read. When the server omits content-length (e.g. chunked responses)
      // the body-size check below is the fallback — note it buffers the whole
      // body first, so it bounds what we SAVE, not peak memory. A hard memory
      // bound would need a streaming reader on FetchResponseLike.
      const declared = Number(response.headers.get("content-length") ?? "");
      if (Number.isFinite(declared) && declared > opts.maxResponseBytes) {
        return (
          `fetch_url: response is ${declared} bytes, over the ` +
          `${opts.maxResponseBytes}-byte limit.`
        );
      }

      let body: string;
      try {
        body = await response.text();
      } catch (err) {
        return `fetch_url: could not read the response body (${errorMessage(err)}).`;
      }
      const bytes = Buffer.byteLength(body, "utf8");
      if (bytes > opts.maxResponseBytes) {
        return (
          `fetch_url: response is ${bytes} bytes, over the ` +
          `${opts.maxResponseBytes}-byte limit.`
        );
      }

      const { title, markdown } = isHtml
        ? htmlToMarkdown(body)
        : { title: undefined, markdown: body };

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
