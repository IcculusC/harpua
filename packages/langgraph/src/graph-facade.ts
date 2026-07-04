import { randomUUID } from "node:crypto";
import type { Type } from "@nestjs/common";
import { Command } from "@langchain/langgraph";
import type { RunnableConfig } from "@langchain/core/runnables";
import type { StateSnapshot } from "@langchain/langgraph";
import type { GraphRegistry } from "./graph-registry";
import type { LangGraphRunnable } from "./interfaces";

/**
 * Injectable facade delegating to the compiled graph held by the
 * {@link GraphRegistry}. Applies the graph's default recursion limit on every
 * call (a caller-supplied `recursionLimit` always wins).
 */
export class GraphFacade<TState = any> implements LangGraphRunnable<TState> {
  constructor(
    private readonly registry: GraphRegistry,
    private readonly graphDef: Type<any>,
  ) {}

  private withDefaults(config?: RunnableConfig): RunnableConfig {
    const limit = this.registry.getRecursionLimit(this.graphDef);
    const merged: RunnableConfig = { ...(config ?? {}) };
    if (limit !== undefined && (merged as any).recursionLimit === undefined) {
      (merged as any).recursionLimit = limit;
    }
    // Every compiled graph carries a checkpointer (to support interrupts), which
    // requires a thread_id. Supply an ephemeral one for stateless calls so
    // callers only need a thread_id when they actually want persistence.
    const configurable = (merged.configurable ?? {}) as Record<string, unknown>;
    if (configurable.thread_id === undefined) {
      merged.configurable = { ...configurable, thread_id: randomUUID() };
    }
    return merged;
  }

  invoke(input: any, config?: RunnableConfig): Promise<TState> {
    return this.registry
      .getCompiled(this.graphDef)
      .invoke(input, this.withDefaults(config));
  }

  stream(input: any, config?: RunnableConfig): Promise<AsyncIterable<any>> {
    return this.registry
      .getCompiled(this.graphDef)
      .stream(input, this.withDefaults(config));
  }

  getState(config: RunnableConfig): Promise<StateSnapshot> {
    return this.registry.getCompiled(this.graphDef).getState(config);
  }

  updateState(
    config: RunnableConfig,
    values: Record<string, unknown> | unknown,
    asNode?: string,
  ): Promise<RunnableConfig> {
    return this.registry
      .getCompiled(this.graphDef)
      .updateState(config, values, asNode);
  }

  resume(
    threadId: string,
    resumeValue: unknown,
    config?: RunnableConfig,
  ): Promise<TState> {
    const merged: RunnableConfig = {
      ...(config ?? {}),
      configurable: {
        ...((config?.configurable as Record<string, unknown>) ?? {}),
        thread_id: threadId,
      },
    };
    return this.invoke(new Command({ resume: resumeValue }), merged);
  }
}
