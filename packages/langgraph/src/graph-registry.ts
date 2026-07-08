import {
  Inject,
  Injectable,
  type OnApplicationBootstrap,
  type Type,
} from "@nestjs/common";
import { ModuleRef } from "@nestjs/core";
import { StateGraph, START, END } from "@langchain/langgraph";
import type { BaseCheckpointSaver } from "@langchain/langgraph";
import { ToolNode } from "@langchain/langgraph/prebuilt";

import { LANGGRAPH_CHECKPOINTER, TOOLS, TOOLS_NODE_ID } from "./constants";
import { getGraphMetadata, isGraphClass } from "./decorators";
import { isAliasRef, isRouteMarker } from "./edges";
import { instrumentNode } from "./observability";
import { buildGraphTools } from "./graph-tools";
import type {
  AnyNodeRef,
  GraphEdge,
  LangGraphOptions,
  NodeHandler,
} from "./interfaces";

type NodeSpec =
  | { kind: "node"; target: Type<any> }
  | { kind: "subgraph"; target: Type<any> };

type CompiledEntry = {
  graph: any;
  recursionLimit?: number;
};

/**
 * Builds and compiles every registered graph at application bootstrap.
 *
 * Nodes are resolved from the Nest DI container (no discovery scan). All
 * structural problems fail fast at bootstrap with actionable errors.
 */
@Injectable()
export class GraphRegistry implements OnApplicationBootstrap {
  private readonly graphDefs = new Set<Type<any>>();
  private readonly compiled = new Map<Type<any>, CompiledEntry>();

  constructor(
    private readonly moduleRef: ModuleRef,
    @Inject(LANGGRAPH_CHECKPOINTER)
    private readonly checkpointer: BaseCheckpointSaver,
  ) {}

  /** Registers a `@LangGraph` definition class for compilation. Idempotent. */
  register(graphDef: Type<any>): void {
    this.graphDefs.add(graphDef);
  }

  onApplicationBootstrap(): void {
    for (const def of this.graphDefs) {
      const meta = this.requireMeta(def);
      const graph = this.buildGraph(def, new Set());
      this.compiled.set(def, { graph, recursionLimit: meta.recursionLimit });
    }
  }

  /** Returns the compiled graph for a registered definition class. */
  getCompiled(graphDef: Type<any>): any {
    const entry = this.compiled.get(graphDef);
    if (!entry) {
      throw new Error(
        `No compiled graph for '${
          (graphDef as { name?: string })?.name ?? String(graphDef)
        }'. Was it registered via LangGraphModule.forFeature and did bootstrap complete?`,
      );
    }
    return entry.graph;
  }

  getRecursionLimit(graphDef: Type<any>): number | undefined {
    return this.compiled.get(graphDef)?.recursionLimit;
  }

  private requireMeta(def: Type<any>): LangGraphOptions {
    const meta = getGraphMetadata(def);
    if (!meta) {
      throw new Error(
        `${(def as { name?: string })?.name ?? String(def)} is not a @LangGraph-decorated class`,
      );
    }
    return meta;
  }

  private buildGraph(def: Type<any>, stack: Set<Type<any>>, isSubgraph = false): any {
    const meta = this.requireMeta(def);
    if (stack.has(def)) {
      throw new Error(
        `Circular subgraph reference detected while building graph '${meta.name}'`,
      );
    }
    stack.add(def);

    const instance = this.resolveGraphInstance(def, meta.name);
    const edges = (instance as { edges?: unknown }).edges as
      | Array<GraphEdge<any>>
      | undefined;
    if (!Array.isArray(edges)) {
      throw new Error(
        `Graph '${meta.name}' (${def.name}) must expose an 'edges' array (use defineEdges).`,
      );
    }

    const graph: any = new StateGraph(meta.state as any);
    const nodeSpecs = new Map<string, NodeSpec>();
    let usesTools = false;

    const registerNode = (id: string, spec: NodeSpec): void => {
      const existing = nodeSpecs.get(id);
      if (existing) {
        if (existing.kind !== spec.kind || existing.target !== spec.target) {
          throw new Error(
            `Duplicate node id '${id}' in graph '${meta.name}': maps to two different targets. Use as() to give one a distinct alias.`,
          );
        }
        return;
      }
      nodeSpecs.set(id, spec);
    };

    const refToId = (ref: unknown, position: string): string => {
      if (ref === START) return START;
      if (ref === END) return END;
      if (ref === TOOLS) {
        usesTools = true;
        return TOOLS_NODE_ID;
      }
      if (isAliasRef(ref)) {
        registerNode(ref.alias, { kind: "node", target: ref.node as Type<any> });
        return ref.alias;
      }
      if (isGraphClass(ref)) {
        const childMeta = getGraphMetadata(ref)!;
        registerNode(childMeta.name, { kind: "subgraph", target: ref });
        return childMeta.name;
      }
      if (typeof ref === "function") {
        registerNode((ref as Type<any>).name, {
          kind: "node",
          target: ref as Type<any>,
        });
        return (ref as Type<any>).name;
      }
      throw new Error(
        `Graph '${meta.name}': invalid ${position} edge reference: ${String(ref)}`,
      );
    };

    // Pass 1: walk every edge to collect the node set (from, to, route pathMaps).
    const edgeOps: Array<() => void> = [];
    for (const edge of edges) {
      const fromId = refToId(edge.from, "source");
      if (isRouteMarker(edge.to)) {
        const marker = edge.to;
        let pathMapObj: Record<string, string> | undefined;
        if (marker.pathMap) {
          pathMapObj = {};
          for (const target of marker.pathMap) {
            const id = refToId(target, "route pathMap");
            pathMapObj[id] = id;
          }
        }
        const wrapped = async (state: any, config: any): Promise<any> => {
          const result = await marker.fn(state, config);
          if (Array.isArray(result)) {
            return result.map((t) => this.routeTargetToId(t, meta.name));
          }
          return this.routeTargetToId(result, meta.name);
        };
        edgeOps.push(() =>
          graph.addConditionalEdges(fromId, wrapped, pathMapObj),
        );
      } else {
        const toId = refToId(edge.to, "target");
        edgeOps.push(() => graph.addEdge(fromId, toId));
      }
    }

    // Add the ToolNode if referenced.
    if (usesTools) {
      const toolEntries = meta.tools ?? [];
      if (toolEntries.length === 0) {
        throw new Error(
          `Graph '${meta.name}' references the TOOLS node but no tool providers were configured (set 'tools' in @LangGraph).`,
        );
      }
      const toolNode = this.buildToolNode(def);
      graph.addNode(
        TOOLS_NODE_ID,
        instrumentNode(TOOLS_NODE_ID, meta.name, (state: any, config: any) =>
          toolNode.invoke(state, config),
        ),
      );
    }

    // Add nodes and subgraphs, resolving each from DI (fail fast).
    for (const [id, spec] of nodeSpecs) {
      if (spec.kind === "subgraph") {
        const child = this.buildGraph(spec.target, new Set(stack), true);
        graph.addNode(id, child);
      } else {
        const nodeInstance = this.resolveNode(spec.target, meta.name);
        const bound = instrumentNode(id, meta.name, (state: any, config: any) =>
          nodeInstance.run(state, config),
        );
        graph.addNode(id, bound);
      }
    }

    // Apply edges after nodes exist.
    for (const op of edgeOps) op();

    const interruptBefore = (meta.interruptBefore ?? []).map((r) =>
      this.routeTargetToId(r, meta.name),
    );
    const interruptAfter = (meta.interruptAfter ?? []).map((r) =>
      this.routeTargetToId(r, meta.name),
    );

    const compiled = graph.compile({
      checkpointer: isSubgraph ? undefined : this.checkpointer,
      interruptBefore: interruptBefore.length ? interruptBefore : undefined,
      interruptAfter: interruptAfter.length ? interruptAfter : undefined,
    });

    stack.delete(def);
    return compiled;
  }

  private routeTargetToId(target: AnyNodeRef | unknown, graphName: string): string {
    if (target === START) return START;
    if (target === END) return END;
    if (target === TOOLS) return TOOLS_NODE_ID;
    if (isAliasRef(target)) return target.alias;
    if (isGraphClass(target)) return getGraphMetadata(target)!.name;
    if (typeof target === "function") return (target as Type<any>).name;
    throw new Error(
      `Graph '${graphName}': unknown route/interrupt target: ${String(target)}`,
    );
  }

  /**
   * The ToolNode that EXECUTES tool calls is built from the exact same tool
   * array {@link buildGraphTools} exposes to a chat model for binding — one
   * source of truth so the model's advertised tools and the executor never
   * drift.
   */
  private buildToolNode(def: Type<any>): ToolNode {
    return new ToolNode(buildGraphTools(def, this.moduleRef));
  }

  private resolveGraphInstance(def: Type<any>, graphName: string): object {
    try {
      return this.moduleRef.get(def, { strict: false });
    } catch {
      throw new Error(
        `Graph definition ${def.name} ('${graphName}') is not resolvable from DI. Register it via LangGraphModule.forFeature([...]).`,
      );
    }
  }

  private resolveNode(
    nodeClass: Type<any>,
    graphName: string,
  ): NodeHandler<any> {
    let instance: any;
    try {
      instance = this.moduleRef.get(nodeClass, { strict: false });
    } catch {
      throw new Error(
        `${nodeClass.name} is referenced by graph '${graphName}' but not provided in any module. Add it to a module's providers.`,
      );
    }
    if (typeof instance?.run !== "function") {
      throw new Error(
        `${nodeClass.name} (referenced by graph '${graphName}') does not implement NodeHandler.run().`,
      );
    }
    return instance as NodeHandler<any>;
  }
}
