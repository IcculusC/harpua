// Framework-agnostic prebuilt LangChain tools for agents. Every tool is exposed
// as a small `factory(options?)` returning a `tool()` instance — the shape all
// future tools follow.
export { thinkTool } from "./think";
export type { ThinkToolOptions } from "./think";
