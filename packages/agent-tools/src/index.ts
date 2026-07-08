// Framework-agnostic prebuilt LangChain tools for agents. Every tool is exposed
// as a small `factory(options?)` returning a `tool()` instance — the shape all
// future tools follow.
export { thinkTool } from "./think";
export type { ThinkToolOptions } from "./think";

// Code-exploration family: sandboxed, read-only, bounded tools for navigating a
// codebase (search_code / read_lines / file_stats). The bundle is the primary
// API; individual factories are exported for one-off use.
export { codeExplorationTools } from "./code-exploration/code-exploration-tools";
export { searchCodeTool, RG_MISSING_MESSAGE } from "./code-exploration/search-code";
export { readLinesTool } from "./code-exploration/read-lines";
export { fileStatsTool } from "./code-exploration/file-stats";
export type {
  CodeExplorationOptions,
  ResolvedCodeExplorationOptions,
} from "./code-exploration/options";
