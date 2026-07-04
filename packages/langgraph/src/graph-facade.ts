import { randomUUID } from "node:crypto";
import type { Type } from "@nestjs/common";
import { Command } from "@langchain/langgraph";
import type { RunnableConfig } from "@langchain/core/runnables";
import type { StateSnapshot } from "@langchain/langgraph";
import type { GraphRegistry } from "./graph-registry";
import type {
  LangGraphRunnable,
  MessageChunk,
  ModeChunk,
  NodeUpdate,
  StreamMode,
} from "./interfaces";

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

  /**
   * Streams the graph. `streamMode` is left to the compiled graph's default
   * (`updates`) unless one is supplied. `thread_id`/`recursionLimit` defaulting
   * matches {@link invoke}. The compiled graph returns an `IterableReadableStream`,
   * which is a plain `AsyncIterable`.
   */
  private streamWith(
    input: any,
    streamMode: StreamMode | StreamMode[] | undefined,
    config?: RunnableConfig,
  ): Promise<AsyncIterable<any>> {
    const merged = this.withDefaults(config);
    if (streamMode !== undefined) {
      (merged as Record<string, unknown>).streamMode = streamMode;
    }
    return this.registry.getCompiled(this.graphDef).stream(input, merged);
  }

  stream(
    input: any,
    config?: RunnableConfig,
  ): Promise<AsyncIterable<NodeUpdate<TState>>> {
    return this.streamWith(input, undefined, config);
  }

  streamValues(
    input: any,
    config?: RunnableConfig,
  ): Promise<AsyncIterable<TState>> {
    return this.streamWith(input, "values", config);
  }

  streamUpdates(
    input: any,
    config?: RunnableConfig,
  ): Promise<AsyncIterable<NodeUpdate<TState>>> {
    return this.streamWith(input, "updates", config);
  }

  streamMessages(
    input: any,
    config?: RunnableConfig,
  ): Promise<AsyncIterable<MessageChunk>> {
    return this.streamWith(input, "messages", config);
  }

  streamModes<const M extends StreamMode>(
    input: any,
    modes: readonly M[],
    config?: RunnableConfig,
  ): Promise<AsyncIterable<ModeChunk<TState, M>>> {
    return this.streamWith(input, [...modes], config);
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
