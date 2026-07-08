import type { StructuredToolInterface } from "@langchain/core/tools";

import { searchCodeTool } from "./search-code";
import { readLinesTool } from "./read-lines";
import { fileStatsTool } from "./file-stats";
import { type CodeExplorationOptions } from "./options";

/**
 * The code-exploration tool family: `search_code`, `read_lines`, and
 * `file_stats`, all sharing one sandbox + cap configuration. Read-only,
 * confined to `options.root`, and bounded so no single call can flood the
 * model's context. Their descriptions teach the workflow — size up with
 * file_stats, locate with search_code, then page with read_lines.
 *
 * This bundle is the primary API (the three tools share config); the individual
 * factories are exported too for when you want only one.
 *
 * @example
 * ```ts
 * import { codeExplorationTools } from "@harpua/agent-tools";
 * import { ToolNode } from "@langchain/langgraph/prebuilt";
 *
 * const toolNode = new ToolNode(codeExplorationTools({ root: process.cwd() }));
 * ```
 */
export function codeExplorationTools(
  options: CodeExplorationOptions,
): StructuredToolInterface[] {
  return [searchCodeTool(options), readLinesTool(options), fileStatsTool(options)];
}
