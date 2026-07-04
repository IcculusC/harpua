import type {
  AliasRef,
  EdgeTarget,
  GraphEdge,
  NodeClassRef,
  RouteMarker,
  RouteResult,
} from "./interfaces";
import type { LangGraphRunnableConfig } from "@langchain/langgraph";

/**
 * Declares a typed edge list for a graph whose composite state is `TGraphState`.
 *
 * Node references are node CLASS references. A class is only accepted in an edge
 * slot when its declared state slice `S` satisfies `TGraphState extends S`, so
 * passing a node that touches state the graph does not provide is a COMPILE
 * error. `defineEdges` itself is an identity function at runtime — the returned
 * array is interpreted by the {@link GraphRegistry} at bootstrap.
 */
export function defineEdges<TGraphState>(
  edges: ReadonlyArray<GraphEdge<TGraphState>>,
): Array<GraphEdge<TGraphState>> {
  return edges as Array<GraphEdge<TGraphState>>;
}

/**
 * Alias a node class so the same provider can be mounted under a distinct id
 * (and thus appear more than once in a single graph).
 */
export function as<TGraphState>(
  alias: string,
  node: NodeClassRef<TGraphState>,
): AliasRef<TGraphState> {
  return { __kind: "alias", alias, node };
}

/**
 * Build a conditional edge. `fn` receives the graph state and returns the next
 * target (a node class, `TOOLS`, `END`, an alias) — or an array of targets for
 * LangGraph's path-map form. Pass `pathMap` to declare the closed set of
 * possible targets (validated fail-fast at bootstrap).
 */
export function route<TGraphState>(
  fn: (
    state: TGraphState,
    config?: LangGraphRunnableConfig,
  ) => RouteResult<TGraphState> | Promise<RouteResult<TGraphState>>,
  pathMap?: ReadonlyArray<EdgeTarget<TGraphState>>,
): RouteMarker<TGraphState> {
  return { __kind: "route", fn, pathMap };
}

export function isAliasRef(value: unknown): value is AliasRef {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as AliasRef).__kind === "alias"
  );
}

export function isRouteMarker(value: unknown): value is RouteMarker {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as RouteMarker).__kind === "route"
  );
}
