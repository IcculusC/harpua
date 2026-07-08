import { tool } from "@langchain/core/tools";
import type { StructuredToolInterface } from "@langchain/core/tools";
import { z } from "zod";

import {
  resolveWebSearchOptions,
  type WebSearchToolOptions,
} from "./options";
import { errorMessage } from "./errors";

const DESCRIPTION =
  "Search the web (via a SearXNG metasearch instance) and get a numbered " +
  "list of results with title, URL, and snippet. Use it to find pages worth " +
  "reading — then call fetch_url on a result to save the page locally for " +
  "detailed searching and reading. Refine the query and search again rather " +
  "than paging; only the top results are returned.";

const webSearchInputSchema = z.object({
  query: z
    .string()
    .min(1)
    .describe("The search query — specific terms work best, e.g. 'LM317 dropout voltage'."),
});

/** Only the fields we read from a SearXNG JSON response; extras are ignored. */
const searxngResponseSchema = z.object({
  results: z
    .array(
      z.object({
        title: z.string(),
        url: z.string(),
        content: z.string().optional(),
      }),
    )
    .optional(),
});

/**
 * `web_search` — query a SearXNG instance's JSON API and return a numbered
 * result list. Never throws: network errors, non-2xx statuses (with a hint
 * that SearXNG's JSON format must be enabled in settings.yml), unparseable
 * bodies, and empty result sets all come back as friendly strings.
 *
 * The model chooses the queries and typically feeds results to `fetch_url`;
 * publicly-deployed apps should gate that follow-up fetch (e.g. with
 * `requireApproval()` from `@harpua/langgraph`) or front it with an allowlist.
 *
 * @example
 * ```ts
 * import { webSearchTool } from "@harpua/agent-tools";
 *
 * const search = webSearchTool({ baseUrl: process.env.SEARXNG_BASE_URL! });
 * ```
 */
export function webSearchTool(
  options: WebSearchToolOptions,
): StructuredToolInterface {
  const opts = resolveWebSearchOptions(options);
  const base = opts.baseUrl.replace(/\/+$/, "");

  return tool(
    async ({ query }) => {
      const url = `${base}/search?q=${encodeURIComponent(query)}&format=json`;

      let response;
      try {
        response = await opts.fetchFn(url, {
          signal: AbortSignal.timeout(opts.timeoutMs),
        });
      } catch (err) {
        return `web_search: request to the search service failed (${errorMessage(err)}).`;
      }

      if (!response.ok) {
        return (
          `web_search: the search service returned HTTP ${response.status}. ` +
          "If this is a SearXNG instance, make sure the JSON format is enabled " +
          "in settings.yml (search: formats: [html, json])."
        );
      }

      let results;
      try {
        results =
          searxngResponseSchema.parse(JSON.parse(await response.text())).results ?? [];
      } catch {
        return "web_search: the search service returned an unexpected response shape.";
      }

      const shown = results.slice(0, opts.maxResults);
      if (shown.length === 0) {
        return `web_search: no results for "${query}" — try different terms.`;
      }

      return shown
        .map((r, i) => {
          const snippet = r.content ? `\n   ${r.content}` : "";
          return `${i + 1}. ${r.title}\n   ${r.url}${snippet}`;
        })
        .join("\n");
    },
    { name: "web_search", description: DESCRIPTION, schema: webSearchInputSchema },
  );
}
