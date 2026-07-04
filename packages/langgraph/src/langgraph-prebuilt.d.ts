// Node10 module resolution does not honor the package `exports` map, so the
// public "@langchain/langgraph/prebuilt" subpath is not resolvable by tsc. This
// ambient declaration bridges the public specifier (used at runtime, where
// Node's resolver DOES honor exports) to the concrete typings file, which
// classic resolution can reach by direct file lookup.
declare module "@langchain/langgraph/prebuilt" {
  export * from "@langchain/langgraph/dist/prebuilt/index";
}
