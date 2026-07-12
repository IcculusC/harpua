import type { InjectionToken, Provider, Type } from "@nestjs/common";
import { START, END } from "@langchain/langgraph";
import { isAIMessage } from "@langchain/core/messages";

import { AGENT_METADATA, TOOLS } from "../constants";
import { defineEdges, route } from "../edges";
import { normalizeMiddleware } from "../middleware/middleware.decorator";
import type { NodeHookName } from "../middleware/middleware.interface";
import { makeCallModelNode } from "./call-model-node";
import { makeStructuredResponseNode } from "./structured-response-node";
import { makeHookNode } from "./hook-node";
import { makeSystemPromptMiddleware } from "./system-prompt-middleware";
import { provideGraphBoundModel } from "../graph-tools";
import type { EdgeTarget, GraphEdge } from "../interfaces";
import type { LangGraphAgentOptions, AgentMetadata } from "./agent.decorator";
import { getAgentMetadata } from "./agent.decorator";

/** The lowered pieces Task 12 needs to register providers for an agent. */
export interface LoweredAgent {
  /** Every generated node class (CallModel, hook nodes, StructuredResponse). */
  generatedNodes: Type<any>[];
  /** The internal bound-model token nodes resolve (see `provideGraphBoundModel`). */
  modelToken: InjectionToken;
  /** `wrapModelCall` middleware classes, in onion order (first = outermost). */
  wrapModelMiddleware: Type<any>[];
  /** `wrapToolCall` middleware classes, in onion order (first = outermost). */
  wrapToolMiddleware: Type<any>[];
}

/** The fully lowered graph an agent's `@LangGraph` is assembled from. */
export interface AgentBuild {
  modelToken: InjectionToken;
  edges: GraphEdge<any>[];
  callModelNode: Type<any>;
  structuredResponseNode?: Type<any>;
  beforeAgentNodes: Type<any>[];
  beforeModelNodes: Type<any>[];
  afterModelNodes: Type<any>[];
  afterAgentNodes: Type<any>[];
  wrapModelMiddleware: Type<any>[];
  wrapToolMiddleware: Type<any>[];
}

const NODE_HOOKS: NodeHookName[] = [
  "beforeAgent",
  "beforeModel",
  "afterModel",
  "afterAgent",
];

/** True when the last message is an AIMessage carrying tool calls. */
function hasToolCalls(state: any): boolean {
  const messages = state?.messages ?? [];
  const last = messages[messages.length - 1];
  return !!last && isAIMessage(last) && (last.tool_calls?.length ?? 0) > 0;
}

/** Give a generated class a stable display name (legible OTel spans/errors). */
function setStableName(cls: Type<any>, name: string): void {
  Object.defineProperty(cls, "name", { value: name, configurable: true });
}

/**
 * Lowers a `@LangGraphAgent`'s options into concrete node classes plus a static
 * edge list matching the canonical agent-loop topology. Routing is entirely
 * edge-level: every hook node's outbound edge is a conditional `route` that
 * sends the loop to its canonical exit when `state.exit.requested` is set (the
 * flag `ctx.exit()` writes), otherwise to the next node in the chain.
 */
export function buildAgentGraph(options: LangGraphAgentOptions): AgentBuild {
  const modelToken: InjectionToken = Symbol(`${options.name}$BoundModel`);
  const usesTools = (options.tools?.length ?? 0) > 0;

  // Partition middleware. A class may fall into several buckets (it is only a
  // node-hook for a hook it actually implements). Node-scoping ({ use, on }) is
  // rejected loudly — silently applying `use` globally would invert the user's
  // intent, which is worse than a no-op.
  const classes = (options.middleware ?? []).map((e) => {
    const entry = normalizeMiddleware(e);
    if (entry.on) {
      throw new Error(
        `@LangGraphAgent '${options.name}': node-scoped middleware ` +
          `({ use, on }) is not supported in v1 — list the middleware class directly.`,
      );
    }
    return entry.use;
  });
  const implementsHook = (c: Type<any>, hook: string): boolean =>
    typeof c.prototype?.[hook] === "function";

  const wrapModelMiddleware = classes.filter((c) => implementsHook(c, "wrapModelCall"));
  const wrapToolMiddleware = classes.filter((c) => implementsHook(c, "wrapToolCall"));

  const hookNodesByHook: Record<NodeHookName, Type<any>[]> = {
    beforeAgent: [],
    beforeModel: [],
    afterModel: [],
    afterAgent: [],
  };
  for (const hook of NODE_HOOKS) {
    for (const mw of classes.filter((c) => implementsHook(c, hook))) {
      const node = makeHookNode({ hook, middlewareClass: mw });
      setStableName(node, `${options.name}$${mw.name}$${hook}`);
      hookNodesByHook[hook].push(node);
    }
  }

  const beforeAgentNodes = hookNodesByHook.beforeAgent;
  const beforeModelNodes = hookNodesByHook.beforeModel;
  const afterModelNodes = hookNodesByHook.afterModel;
  const afterAgentNodes = hookNodesByHook.afterAgent;

  // systemPrompt lowers to an OUTERMOST wrapModelCall middleware (prepends a
  // SystemMessage) — see makeSystemPromptMiddleware for why not a node.
  const effectiveWrapModel = [...wrapModelMiddleware];
  if (options.systemPrompt !== undefined) {
    const spMw = makeSystemPromptMiddleware({ systemPrompt: options.systemPrompt });
    setStableName(spMw, `${options.name}$SystemPromptMiddleware`);
    effectiveWrapModel.unshift(spMw);
  }

  const callModelNode = makeCallModelNode({
    modelToken,
    wrapMiddleware: effectiveWrapModel,
  });
  setStableName(callModelNode, `${options.name}$CallModel`);

  let structuredResponseNode: Type<any> | undefined;
  if (options.responseFormat !== undefined) {
    structuredResponseNode = makeStructuredResponseNode({
      modelToken: options.model,
      schema: options.responseFormat,
    });
    setStableName(structuredResponseNode, `${options.name}$StructuredResponse`);
  }

  // The exit path: what runs once the loop is done (or short-circuited). Its
  // first node is the canonical exit target the loop routes to.
  const exitPath: Type<any>[] = [
    ...(structuredResponseNode ? [structuredResponseNode] : []),
    ...afterAgentNodes,
  ];
  const exitTarget: EdgeTarget<any> = exitPath[0] ?? END;

  const edges: GraphEdge<any>[] = [];

  // A hook node's outbound: exit if the hook flipped `exit.requested`, else next.
  const conditionalNext = (
    from: Type<any>,
    next: EdgeTarget<any>,
  ): GraphEdge<any> => ({
    from,
    to: route<any>(
      (s) => (s?.exit?.requested ? exitTarget : next),
      [exitTarget, next],
    ),
  });

  const modelRouter = () =>
    route<any>(
      (s) => {
        if (s?.exit?.requested) return exitTarget;
        if (usesTools && hasToolCalls(s)) return TOOLS;
        return exitTarget;
      },
      usesTools ? [TOOLS, exitTarget] : [exitTarget],
    );

  // START -> beforeAgent… -> beforeModel… -> CallModel.
  //
  // The beforeAgent SEGMENT chains unconditionally: a thread can carry a
  // PERSISTED `exit.requested` from its previous turn (that is how a budget
  // stop ends a run), and routing on it mid-segment would send the run to the
  // exit before a later beforeAgent hook — Budget's per-invoke reset — gets
  // to clear it, permanently sticking the thread (issue #54). The exit check
  // for the segment happens once, on its LAST node's outbound edge: by then
  // every beforeAgent hook has run, a stale exit has been cleared by a
  // reset-style hook (or deliberately kept, under `reset: "thread"`), and a
  // fresh `ctx.exit()` from any beforeAgent hook still routes out before the
  // model runs. (Corollary, documented: order a reset-style hook FIRST among
  // beforeAgent middlewares — a later reset would also clear a sibling's
  // fresh same-turn exit.) beforeModel hooks keep per-node conditionals.
  const preModel = [...beforeAgentNodes, ...beforeModelNodes];
  const firstStart = preModel[0] ?? callModelNode;
  edges.push({ from: START, to: firstStart });
  preModel.forEach((node, i) => {
    const next = preModel[i + 1] ?? callModelNode;
    const isMidBeforeAgent = i < beforeAgentNodes.length - 1;
    if (isMidBeforeAgent) {
      edges.push({ from: node, to: next });
    } else {
      edges.push(conditionalNext(node, next));
    }
  });

  // TOOLS loop-back re-enters at the shared beforeModel chain (beforeAgent runs
  // once, at START only). The chain's outbound edges are already declared above.
  if (usesTools) {
    edges.push({ from: TOOLS, to: beforeModelNodes[0] ?? callModelNode });
  }

  // CallModel -> afterModel… -> MODEL_ROUTER. CallModel is not a hook node, so
  // its edge into the afterModel chain is plain; the router subsumes the last
  // afterModel node's exit check.
  if (afterModelNodes.length === 0) {
    edges.push({ from: callModelNode, to: modelRouter() });
  } else {
    edges.push({ from: callModelNode, to: afterModelNodes[0]! });
    afterModelNodes.forEach((node, i) => {
      if (i < afterModelNodes.length - 1) {
        edges.push(conditionalNext(node, afterModelNodes[i + 1]!));
      } else {
        edges.push({ from: node, to: modelRouter() });
      }
    });
  }

  // Exit path -> END. Plain edges: these nodes run PAST the loop (terminal
  // position), so an afterAgent hook calling `ctx.exit()` here is a routing
  // no-op — there is nowhere left to short-circuit to.
  exitPath.forEach((node, i) => {
    edges.push({ from: node, to: exitPath[i + 1] ?? END });
  });

  return {
    modelToken,
    edges: defineEdges<any>(edges),
    callModelNode,
    structuredResponseNode,
    beforeAgentNodes,
    beforeModelNodes,
    afterModelNodes,
    afterAgentNodes,
    wrapModelMiddleware: effectiveWrapModel,
    wrapToolMiddleware,
  };
}

/**
 * Reads an agent's lowered structure back off its class — the pieces Task 12's
 * module registration needs (generated node providers, the internal bound-model
 * token, and the wrap middleware to register). Throws if the class was not
 * decorated with `@LangGraphAgent`.
 */
export function lowerAgent(def: Type<any>): LoweredAgent {
  const meta = Reflect.getMetadata(AGENT_METADATA, def) as
    | AgentMetadata
    | undefined;
  if (!meta) {
    throw new Error(
      `${(def as { name?: string })?.name ?? String(def)} is not a @LangGraphAgent-decorated class`,
    );
  }
  const b = meta.build;
  const generatedNodes: Type<any>[] = [
    ...b.beforeAgentNodes,
    ...b.beforeModelNodes,
    b.callModelNode,
    ...b.afterModelNodes,
    ...(b.structuredResponseNode ? [b.structuredResponseNode] : []),
    ...b.afterAgentNodes,
  ];
  return {
    generatedNodes,
    modelToken: b.modelToken,
    wrapModelMiddleware: b.wrapModelMiddleware,
    wrapToolMiddleware: b.wrapToolMiddleware,
  };
}

/**
 * The DI providers a `@LangGraphAgent` needs so {@link GraphRegistry} can
 * resolve its generated nodes and the internally-bound model: every generated
 * node class (`lowerAgent`'s `generatedNodes`), every middleware class the
 * agent references — both node-hook middleware (resolved by generated hook
 * nodes) and wrap middleware (resolved by `CallModelNode`/tool-wrap, plus the
 * internal `systemPrompt` middleware, which only shows up in
 * `wrapModelMiddleware`) — and a `provideGraphBoundModel` binding under the
 * agent's internal per-agent model token. Spread into `forFeature`'s
 * `providers` alongside the graph definition class itself.
 */
export function agentProviders(def: Type<any>): Provider[] {
  const lowered = lowerAgent(def);
  const meta = getAgentMetadata(def);
  if (!meta) {
    throw new Error(
      `${(def as { name?: string })?.name ?? String(def)} is not a @LangGraphAgent-decorated class`,
    );
  }
  const userMw = (meta.middleware ?? []).map((e) => normalizeMiddleware(e).use);
  const allMw = Array.from(
    new Set([...userMw, ...lowered.wrapModelMiddleware, ...lowered.wrapToolMiddleware]),
  );
  return [
    ...lowered.generatedNodes,
    ...allMw,
    provideGraphBoundModel({
      provide: lowered.modelToken,
      graph: def,
      model: meta.model,
    }),
  ];
}
