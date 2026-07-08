import type { StructuredToolInterface } from "@langchain/core/tools";

import { searchFilesTool } from "./search-files";
import { readLinesTool } from "./read-lines";
import { fileStatsTool } from "./file-stats";
import { type FileExplorationOptions } from "./options";

/**
 * The file-exploration tool family: `search_files`, `read_lines`, and
 * `file_stats`, all sharing one sandbox + cap configuration. Read-only,
 * confined to `options.root`, and bounded so no single call can flood the
 * model's context. Their descriptions teach the workflow — size up with
 * file_stats, locate with search_files, then page with read_lines.
 *
 * This bundle is the primary API (the three tools share config); the individual
 * factories are exported too for when you want only one.
 *
 * @example
 * ```ts
 * import { fileExplorationTools } from "@harpua/agent-tools";
 * import { ToolNode } from "@langchain/langgraph/prebuilt";
 *
 * const toolNode = new ToolNode(fileExplorationTools({ root: process.cwd() }));
 * ```
 */
export function fileExplorationTools(
  options: FileExplorationOptions,
): StructuredToolInterface[] {
  return [searchFilesTool(options), readLinesTool(options), fileStatsTool(options)];
}
