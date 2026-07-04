/**
 * Sentinel used in edge definitions to reference the compiled ToolNode built
 * from the graph's `tools` provider classes. Distinct object identity so it can
 * never collide with a user node id.
 */
export const TOOLS: unique symbol = Symbol.for("@harpua/nestjs-langgraph:TOOLS");
export type TOOLS = typeof TOOLS;

/** Internal node id under which the ToolNode is mounted in the compiled graph. */
export const TOOLS_NODE_ID = "tools";

/** DI token exposing the configured checkpointer (defaults to MemorySaver). */
export const LANGGRAPH_CHECKPOINTER = Symbol.for(
  "@harpua/nestjs-langgraph:CHECKPOINTER",
);

/** DI token for the module options passed to forRoot/forRootAsync. */
export const LANGGRAPH_MODULE_OPTIONS = Symbol.for(
  "@harpua/nestjs-langgraph:MODULE_OPTIONS",
);

/** reflect-metadata key holding the {@link LangGraphOptions} on a graph class. */
export const GRAPH_METADATA = Symbol.for(
  "@harpua/nestjs-langgraph:GRAPH_METADATA",
);

/** reflect-metadata key holding the array of tool method descriptors. */
export const TOOL_METHODS_METADATA = Symbol.for(
  "@harpua/nestjs-langgraph:TOOL_METHODS",
);

/**
 * Builds the injection token for the runnable facade of a graph definition
 * class. Used by both {@link LangGraphModule.forFeature} and
 * {@link InjectLangGraphRunnable}.
 */
export function getGraphFacadeToken(graphDef: { name: string }): string {
  return `LangGraphRunnable:${graphDef.name}`;
}
