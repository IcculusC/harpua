import path from "node:path";
import { tool } from "@langchain/core/tools";
import type { StructuredToolInterface } from "@langchain/core/tools";
import type { RunnableConfig } from "@langchain/core/runnables";
import { z } from "zod";

import {
  resolveFetchPdfOptions,
  type FetchPdfToolOptions,
} from "./options";
import { errorMessage } from "./errors";
import { fetchGuarded, readBytesCapped } from "./fetch-guarded";
import { savePage } from "./save-page";

/** Coaching hint returned when the optional `unpdf` peer isn't installed. */
export const UNPDF_MISSING_MESSAGE =
  'fetch_pdf requires the optional "unpdf" package — install it: pnpm add unpdf';

const DESCRIPTION =
  "Fetch a PDF by URL, extract its text, and save it locally as markdown so it " +
  "can be searched and read — the same fetch → save → explore loop as fetch_url, " +
  "but for PDFs. Give it an http(s) URL to a PDF; it verifies the content type, " +
  "extracts the text, saves the file, and tells you the saved path. Then use " +
  "search_files to find terms in it and read_lines to read it. SECURITY: fetches " +
  "whatever URL is supplied; private/loopback addresses are refused by default.";

const fetchPdfInputSchema = z.object({
  url: z.string().min(1).describe("The absolute http(s) URL of the PDF to fetch."),
});

/**
 * `fetch_pdf` — fetch a PDF, extract its text with the optional `unpdf` peer,
 * and save it (with url/title/fetched frontmatter) into `saveDir` so it becomes
 * explorable exactly like a `fetch_url` page. Opt-in: it is NOT part of the
 * `webResearchTools()` bundle, and `unpdf` is an optional peer dependency — if
 * it isn't installed the tool returns an install hint instead of throwing.
 * Never throws: bad schemes, network errors, non-2xx statuses, non-PDF content
 * types, oversize bodies, a missing `unpdf`, extraction failures, and
 * filesystem failures all come back as friendly strings.
 *
 * @example
 * ```ts
 * // pnpm add unpdf
 * import { fetchPdfTool, fileExplorationTools } from "@harpua/agent-tools";
 *
 * const fetchPdf = fetchPdfTool({ saveDir: "./sources" });
 * ```
 */
export function fetchPdfTool(
  options: FetchPdfToolOptions,
): StructuredToolInterface {
  const opts = resolveFetchPdfOptions(options);

  return tool(
    async ({ url: input }, config?: RunnableConfig) => {
      const guarded = await fetchGuarded("fetch_pdf", input, {
        allowPrivate: opts.allowPrivate,
        timeoutMs: opts.timeoutMs,
        maxResponseBytes: opts.maxResponseBytes,
        fetchFn: opts.fetchFn,
      });
      if (!guarded.ok) return guarded.error;
      const { finalUrl, contentType, response } = guarded;

      if (!contentType.includes("application/pdf")) {
        return (
          `fetch_pdf: ${finalUrl.toString()} is not a PDF (server returned ` +
          `"${contentType || "unknown"}") — only application/pdf is supported. ` +
          "Use fetch_url for HTML and plain-text pages."
        );
      }

      const read = await readBytesCapped("fetch_pdf", response, opts.maxResponseBytes);
      if (!read.ok) return read.error;

      // `unpdf` is an OPTIONAL peer loaded lazily. A missing install rejects
      // here; translate it into an install hint instead of throwing mid-graph.
      let unpdf;
      try {
        unpdf = await opts.loadUnpdf();
      } catch {
        return UNPDF_MISSING_MESSAGE;
      }

      let text: string;
      let totalPages: number;
      try {
        ({ text, totalPages } = await unpdf.extractText(read.bytes, {
          mergePages: true,
        }));
      } catch (err) {
        return `fetch_pdf: could not extract text from the PDF (${errorMessage(err)}).`;
      }

      const dir =
        typeof opts.saveDir === "function" ? opts.saveDir(config) : opts.saveDir;
      const fetched = opts.now().toISOString().slice(0, 10);

      let saved: string;
      try {
        saved = savePage({ dir, url: finalUrl, markdown: text, fetched });
      } catch (err) {
        return `fetch_pdf: could not save the page (${errorMessage(err)}).`;
      }

      // Extracted PDF text is often one long run with no newlines, so a line
      // count (fetch_url's metric) would be nonsensical here — report the
      // extracted size in chars/pages instead.
      const label = `${finalUrl.host}${finalUrl.pathname}`;
      const pageWord = totalPages === 1 ? "page" : "pages";
      // Bare filename, not a cwd-relative path — the jailed file tools
      // address files relative to this same directory (see fetch-url.ts).
      return (
        `Saved "${label}" (${text.length.toLocaleString()} chars, ${totalPages} ${pageWord}) as ${path.basename(saved)}.\n` +
        "Search it with search_files or read it with read_lines."
      );
    },
    { name: "fetch_pdf", description: DESCRIPTION, schema: fetchPdfInputSchema },
  );
}
