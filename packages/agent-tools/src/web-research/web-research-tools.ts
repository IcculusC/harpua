import type { StructuredToolInterface } from "@langchain/core/tools";

import { webSearchTool } from "./web-search";
import { fetchUrlTool } from "./fetch-url";
import {
  webResearchToolsOptionsSchema,
  type WebResearchToolsOptions,
} from "./options";

/**
 * The web-research tool family: `web_search` (SearXNG-backed) and `fetch_url`
 * (fetch → markdown → save), sharing one options object. Fetched pages land
 * in `saveDir` as frontmattered markdown — pair with `fileExplorationTools`
 * jailed to the same directory so the agent can search and read what it
 * saved. Their descriptions teach the workflow: search, fetch, then explore.
 *
 * This bundle is the primary API; the individual factories are exported too.
 *
 * @example
 * ```ts
 * import fs from "node:fs";
 * import { webResearchTools, fileExplorationTools } from "@harpua/agent-tools";
 * import { ToolNode } from "@langchain/langgraph/prebuilt";
 *
 * const sources = "./sources";
 * fs.mkdirSync(sources, { recursive: true });
 * const toolNode = new ToolNode([
 *   ...webResearchTools({ baseUrl: "http://localhost:8080", saveDir: sources }),
 *   ...fileExplorationTools({ root: sources }),
 * ]);
 * ```
 */
export function webResearchTools(
  options: WebResearchToolsOptions,
): StructuredToolInterface[] {
  const opts = webResearchToolsOptionsSchema.parse(options);
  return [
    webSearchTool({
      baseUrl: opts.baseUrl,
      ...(opts.maxResults !== undefined && { maxResults: opts.maxResults }),
      ...(opts.timeoutMs !== undefined && { timeoutMs: opts.timeoutMs }),
      ...(opts.fetchFn !== undefined && { fetchFn: opts.fetchFn }),
    }),
    fetchUrlTool({
      saveDir: opts.saveDir,
      ...(opts.maxResponseBytes !== undefined && {
        maxResponseBytes: opts.maxResponseBytes,
      }),
      ...(opts.timeoutMs !== undefined && { timeoutMs: opts.timeoutMs }),
      ...(opts.allowPrivate !== undefined && { allowPrivate: opts.allowPrivate }),
      ...(opts.fetchFn !== undefined && { fetchFn: opts.fetchFn }),
      ...(opts.now !== undefined && { now: opts.now }),
    }),
  ];
}
