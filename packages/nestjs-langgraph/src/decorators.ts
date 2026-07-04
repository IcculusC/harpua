import { Inject, Injectable } from "@nestjs/common";
import type { Type } from "@nestjs/common";
import {
  GRAPH_METADATA,
  TOOL_METHODS_METADATA,
  getGraphFacadeToken,
} from "./constants";
import type { LangGraphOptions, ToolMethodMetadata } from "./interfaces";

/**
 * Marks a class as a LangGraph graph definition. The class is expected to expose
 * an `edges` member (typically `defineEdges<State>([...])`). Also makes the class
 * injectable so the {@link GraphRegistry} can resolve it via the DI container.
 */
export function LangGraph(options: LangGraphOptions): ClassDecorator {
  return (target) => {
    Reflect.defineMetadata(GRAPH_METADATA, options, target);
    // Apply @Injectable so forFeature can register the class as a provider.
    Injectable()(target as unknown as Type<unknown>);
  };
}

/** Reads the {@link LangGraphOptions} off a decorated graph class, if any. */
export function getGraphMetadata(
  target: unknown,
): LangGraphOptions | undefined {
  if (typeof target !== "function") return undefined;
  return Reflect.getMetadata(GRAPH_METADATA, target) as
    | LangGraphOptions
    | undefined;
}

export function isGraphClass(target: unknown): target is Type<any> {
  return getGraphMetadata(target) !== undefined;
}

export interface LangGraphToolOptions {
  name?: string;
  description: string;
  schema: unknown;
}

/**
 * Marks a method on an `@Injectable` provider as a LangGraph tool. The method is
 * later bound to its DI instance and wrapped via `tool()` into the graph's
 * ToolNode. Metadata is stored per class and only scanned for the explicitly
 * listed tool provider classes — never app-wide.
 */
export function LangGraphTool(
  options: LangGraphToolOptions,
): MethodDecorator {
  return (target, propertyKey) => {
    const ctor = target.constructor;
    const existing: ToolMethodMetadata[] =
      (Reflect.getMetadata(TOOL_METHODS_METADATA, ctor) as
        | ToolMethodMetadata[]
        | undefined) ?? [];
    existing.push({
      methodName: propertyKey,
      name: options.name,
      description: options.description,
      schema: options.schema,
    });
    Reflect.defineMetadata(TOOL_METHODS_METADATA, existing, ctor);
  };
}

/** Reads the tool method descriptors declared on a provider class. */
export function getToolMethods(target: Type<any>): ToolMethodMetadata[] {
  return (
    (Reflect.getMetadata(TOOL_METHODS_METADATA, target) as
      | ToolMethodMetadata[]
      | undefined) ?? []
  );
}

/**
 * Injects the {@link LangGraphRunnable} facade for a `@LangGraph`-decorated
 * graph definition class registered via `LangGraphModule.forFeature`.
 */
export function InjectLangGraphRunnable(
  graphDef: Type<any>,
): ParameterDecorator {
  const meta = getGraphMetadata(graphDef);
  if (!meta) {
    throw new Error(
      `@InjectLangGraphRunnable: ${
        (graphDef as { name?: string })?.name ?? String(graphDef)
      } is not a @LangGraph-decorated class`,
    );
  }
  return Inject(getGraphFacadeToken(meta));
}
