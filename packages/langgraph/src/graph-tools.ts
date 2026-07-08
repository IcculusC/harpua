import type { InjectionToken, Provider, Type } from "@nestjs/common";
import { ModuleRef } from "@nestjs/core";
import { tool } from "@langchain/core/tools";
import type { StructuredToolInterface } from "@langchain/core/tools";
import type { Runnable } from "@langchain/core/runnables";
import type { BaseLanguageModelInput } from "@langchain/core/language_models/base";
import type {
  BaseChatModel,
  BaseChatModelCallOptions,
} from "@langchain/core/language_models/chat_models";
import type { AIMessageChunk } from "@langchain/core/messages";
import { z } from "zod";

import { getGraphMetadata, getToolMethods } from "./decorators";
import { instrumentRawTool, instrumentTool } from "./observability";

/**
 * Structural, fork-safe test for a raw LangChain tool INSTANCE. A `tool(...)`
 * result is an object exposing `lc_namespace`, a `name`, and an `invoke`
 * method; a provider CLASS is a constructor `function` and fails this parse.
 * Kept structural (not `instanceof`) so a tool built against a pnpm-forked
 * copy of `@langchain/core` is still recognised.
 */
const rawToolSchema = z.object({
  lc_namespace: z.array(z.string()),
  name: z.string().min(1),
  invoke: z.custom<(...args: any[]) => unknown>((v) => typeof v === "function"),
});

/**
 * The runnable a graph-bound model exposes: `bindTools` on any `BaseChatModel`
 * returns exactly this — a `Runnable` over the model's message input/output —
 * and an un-bound `BaseChatModel` is assignable to it too. Annotate the token a
 * node injects with this type (both `provideGraphBoundModel` arms produce it).
 */
export type GraphBoundModel = Runnable<
  BaseLanguageModelInput,
  AIMessageChunk,
  BaseChatModelCallOptions
>;

/**
 * Builds the SAME LangChain tool array a graph's `ToolNode` mounts: every
 * `@LangGraphTool` method on each DI-resolved provider class listed in
 * `@LangGraph({ tools })`, plus each raw `StructuredToolInterface` instance,
 * all wrapped with the same `langgraph.tool <name>` tracing. This is the single
 * source of truth shared by the `ToolNode` builder (which executes tool calls)
 * and `provideGraphBoundModel`/`provideGraphTools` (which expose the schemas to
 * a chat model so it can emit tool calls).
 *
 * A graph with no `tools` yields an empty array (so a bound model is returned
 * unchanged). A graph that lists providers exposing no `@LangGraphTool` methods,
 * or an entry that is neither a provider class nor a raw tool, fails fast — the
 * same errors the `ToolNode` path has always raised.
 */
export function buildGraphTools(
  graphDef: Type<any>,
  moduleRef: ModuleRef,
): StructuredToolInterface[] {
  const meta = getGraphMetadata(graphDef);
  if (!meta) {
    throw new Error(
      `${
        (graphDef as { name?: string })?.name ?? String(graphDef)
      } is not a @LangGraph-decorated class`,
    );
  }
  const graphName = meta.name;
  const toolEntries = meta.tools ?? [];
  const tools: StructuredToolInterface[] = [];

  for (const entry of toolEntries) {
    // Raw LangChain tool instance: mount as-is, wrapped for tracing.
    if (rawToolSchema.safeParse(entry).success) {
      tools.push(instrumentRawTool(entry as StructuredToolInterface));
      continue;
    }
    // Provider class: resolve from DI and wrap each @LangGraphTool method.
    if (typeof entry === "function") {
      const cls = entry as Type<any>;
      let instance: any;
      try {
        instance = moduleRef.get(cls, { strict: false });
      } catch {
        throw new Error(
          `Tool provider ${cls.name} is listed by graph '${graphName}' but not provided in any module.`,
        );
      }
      const methods = getToolMethods(cls);
      for (const m of methods) {
        const toolName = m.name ?? String(m.methodName);
        const fn = (instance[m.methodName] as (...a: any[]) => any).bind(
          instance,
        );
        tools.push(
          tool(instrumentTool(toolName, fn), {
            name: toolName,
            description: m.description,
            schema: m.schema as any,
          }),
        );
      }
      continue;
    }
    throw new Error(
      `Graph '${graphName}': tools entry ${String(
        entry,
      )} is neither a tool provider class nor a raw LangChain tool instance.`,
    );
  }

  if (toolEntries.length > 0 && tools.length === 0) {
    throw new Error(
      `Graph '${graphName}' lists tool providers but none expose @LangGraphTool methods.`,
    );
  }
  return tools;
}

/**
 * Injection token under which {@link provideGraphTools} publishes a graph's raw
 * tool array. Derived from the graph's `@LangGraph({ name })` so it matches the
 * facade token's naming — inject it with `@Inject(getGraphToolsToken(MyGraph))`.
 */
export function getGraphToolsToken(graphDef: Type<any>): string {
  const meta = getGraphMetadata(graphDef);
  if (!meta) {
    throw new Error(
      `getGraphToolsToken: ${
        (graphDef as { name?: string })?.name ?? String(graphDef)
      } is not a @LangGraph-decorated class`,
    );
  }
  return `GraphTools:${meta.name}`;
}

export interface ProvideGraphToolsOptions {
  /** The `@LangGraph`-decorated graph definition class. */
  graph: Type<any>;
  /** Token to publish under; defaults to {@link getGraphToolsToken}(graph). */
  provide?: InjectionToken;
}

/**
 * Custom provider exposing a graph's tool array (a `StructuredToolInterface[]`)
 * for apps that want to bind it to a model themselves. The lower-level primitive
 * {@link provideGraphBoundModel} composes. The factory injects `ModuleRef` and
 * builds the array eagerly during instantiation — the tool provider classes it
 * resolves via `ModuleRef.get(strict:false)` are DI singletons, resolvable then.
 */
export function provideGraphTools(options: ProvideGraphToolsOptions): Provider {
  const { graph, provide } = options;
  return {
    provide: provide ?? getGraphToolsToken(graph),
    useFactory: (moduleRef: ModuleRef): StructuredToolInterface[] =>
      buildGraphTools(graph, moduleRef),
    inject: [ModuleRef],
  };
}

export interface ProvideGraphBoundModelOptions {
  /** Token the app chooses for the bound model; nodes inject this. */
  provide: InjectionToken;
  /** The `@LangGraph`-decorated graph whose tools the model should carry. */
  graph: Type<any>;
  /**
   * Any token resolving to a `BaseChatModel` — a class, symbol, or string. This
   * package stays model-agnostic: it never references a concrete model package.
   */
  model: InjectionToken;
}

/**
 * Custom provider that binds a graph's tools to a chat model so a real model can
 * actually emit the tool calls the graph's `ToolNode` executes. The factory
 * resolves the `model` token and the graph's tool array, then returns
 * `model.bindTools(tools)` when the graph has tools (a {@link GraphBoundModel}
 * runnable) or the model unchanged when it has none. Package-agnostic: `model`
 * is any DI token the app owns.
 *
 * Timing: the factory runs during DI instantiation (earlier than the registry's
 * `onApplicationBootstrap` compile), but only reads the graph metadata and
 * resolves already-registered singletons via `ModuleRef` — it never touches the
 * compiled graph, so it cannot race compilation.
 */
export function provideGraphBoundModel(
  options: ProvideGraphBoundModelOptions,
): Provider {
  const { provide, graph, model } = options;
  return {
    provide,
    useFactory: (
      moduleRef: ModuleRef,
      chatModel: BaseChatModel,
    ): GraphBoundModel => {
      const tools = buildGraphTools(graph, moduleRef);
      if (tools.length > 0 && typeof chatModel.bindTools === "function") {
        return chatModel.bindTools(tools);
      }
      return chatModel;
    },
    inject: [ModuleRef, model],
  };
}
