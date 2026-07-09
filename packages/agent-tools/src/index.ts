// Framework-agnostic prebuilt LangChain tools for agents. Every tool is exposed
// as a small `factory(options?)` returning a `tool()` instance — the shape all
// future tools follow.
export { thinkTool } from "./think";
export type { ThinkToolOptions } from "./think";

// Code-exploration family: sandboxed, read-only, bounded tools for navigating a
// codebase (search_files / read_lines / file_stats). The bundle is the primary
// API; individual factories are exported for one-off use.
export { fileExplorationTools } from "./file-exploration/file-exploration-tools";
export { searchFilesTool, RG_MISSING_MESSAGE } from "./file-exploration/search-files";
export { readLinesTool } from "./file-exploration/read-lines";
export { fileStatsTool } from "./file-exploration/file-stats";
export type {
  FileExplorationOptions,
  ResolvedFileExplorationOptions,
} from "./file-exploration/options";

// Web-research family: web_search (SearXNG-backed) and fetch_url (fetch →
// markdown → save). Saved pages pair with fileExplorationTools jailed to the
// same directory. The bundle is the primary API; factories exported for
// one-off use.
export { webResearchTools } from "./web-research/web-research-tools";
export { webSearchTool } from "./web-research/web-search";
export { fetchUrlTool } from "./web-research/fetch-url";
// `fetch_pdf` is OPT-IN: exported for explicit use, but NOT in the
// webResearchTools() bundle. It needs the optional `unpdf` peer (pnpm add unpdf).
export { fetchPdfTool, UNPDF_MISSING_MESSAGE } from "./web-research/fetch-pdf";
export type {
  WebSearchToolOptions,
  FetchUrlToolOptions,
  FetchPdfToolOptions,
  WebResearchToolsOptions,
  FetchFn,
  FetchResponseLike,
  SaveDirResolver,
  LoadUnpdf,
  UnpdfModuleLike,
  ResolvedWebSearchToolOptions,
  ResolvedFetchUrlToolOptions,
  ResolvedFetchPdfToolOptions,
} from "./web-research/options";
