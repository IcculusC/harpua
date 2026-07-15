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
export {
  DEFAULT_SECRET_PATTERNS,
  isSecretPath,
} from "./file-exploration/secret-paths";
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

// Knowledge family: search_knowledge — chunk/embed/index/cosine retrieval
// over a directory of markdown (the corpus fetch_url/fetch_pdf build).
// Keyless by default via MockEmbeddings; pass any LangChain embeddings
// instance for real semantics.
export { searchKnowledgeTool } from "./knowledge/search-knowledge";
export { rememberTool } from "./knowledge/remember";
export type { RememberToolOptions } from "./knowledge/remember";
export { MockEmbeddings, MOCK_EMBEDDING_DIMENSION } from "./knowledge/mock-embeddings";
export { chunkMarkdown } from "./knowledge/chunk-markdown";
export type { MarkdownChunk } from "./knowledge/chunk-markdown";
// Pure chunk-prep half of ingest() — chunk/sanitize/junk-filter/embed-text
// formatting with no embedding or storage. For a consumer running its own
// embed/upsert path into a separate collection; ingest() composes over it.
export { prepareChunks } from "./knowledge/prepare-chunks";
export type { PreparedChunk, PrepareChunksOptions } from "./knowledge/prepare-chunks";
// Pluggable vector store (BYO). The built-in corpus retrieval (queryCorpus)
// stays internal — it is the default path, not a public store.
export { InMemoryVectorStore } from "./knowledge/in-memory-vector-store";
export { syncCorpus } from "./knowledge/sync-corpus";
export { ingest } from "./knowledge/ingest";
export type { Document, IngestOptions, IngestResult } from "./knowledge/ingest";
export type {
  VectorStore,
  VectorRecord,
  VectorMatch,
  BaseQueryOptions,
} from "./knowledge/vector-store";
export type {
  SearchKnowledgeToolOptions,
  ResolvedSearchKnowledgeToolOptions,
  KnowledgeRootResolver,
} from "./knowledge/options";

// Runtime skills family: the app's OWN agent discovers, loads, and follows
// skills at runtime (the counterpart to dev-time skill linking). Registry +
// two tools; the live-menu system-prompt middleware stays a documented
// recipe in the consuming framework (see README) so this package keeps its
// LCD dependency surface.
export { SkillRegistry } from "./skills/skill-registry";
export type { Skill, SkillRef, SkillRescanResult, SkillRegistryOptions } from "./skills/skill-registry";
export { renderSkillMenu } from "./skills/render-skill-menu";
export { useSkillTool } from "./skills/use-skill";
export { readSkillFileTool } from "./skills/read-skill-file";
export type { SkillToolOptions } from "./skills/options";
