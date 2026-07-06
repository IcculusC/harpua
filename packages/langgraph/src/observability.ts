import { z } from "zod";

import { requireOptionalModule } from "./optional-require";

/**
 * Plain OpenTelemetry tracing for compiled graphs. Instrumentation is built on
 * `@opentelemetry/api` ONLY: that package is a no-op until a consumer registers
 * an SDK, so when it resolves the spans are always-on and free until someone
 * wires up a TracerProvider. When it is not installed at all we degrade to zero
 * instrumentation — unlike the checkpointer's optional peers this is never an
 * error, just a silent no-op fallback (there is nothing the consumer must do).
 *
 * No message contents or tool arguments are ever recorded (PII / span size).
 */

type OtelApi = typeof import("@opentelemetry/api");
type Span = import("@opentelemetry/api").Span;
type Attributes = import("@opentelemetry/api").Attributes;

const TRACER_NAME = "@harpua/langgraph";

/** Stable, low-cardinality span attribute keys. */
export const ATTR = {
  graphName: "langgraph.graph.name",
  nodeName: "langgraph.node.name",
  toolName: "langgraph.tool.name",
  threadId: "langgraph.thread_id",
} as const;

/** A resolved thread_id is a non-empty string; anything else is treated as absent. */
const threadIdSchema = z.string().min(1);

const moduleNotFoundError = z.object({
  code: z.enum(["MODULE_NOT_FOUND", "ERR_MODULE_NOT_FOUND"]),
});

// undefined = not yet attempted, null = confirmed absent, object = loaded.
let cachedApi: OtelApi | null | undefined;

/**
 * Resolves `@opentelemetry/api` once. A missing install yields `null` (silent
 * no-op); any other load failure is a genuinely broken install and rethrows.
 */
function loadOtel(): OtelApi | null {
  if (cachedApi !== undefined) return cachedApi;
  try {
    cachedApi = requireOptionalModule("@opentelemetry/api") as OtelApi;
  } catch (err) {
    if (moduleNotFoundError.safeParse(err).success) {
      cachedApi = null;
    } else {
      throw err;
    }
  }
  return cachedApi;
}

/** Test seam: forget the cached resolution so a spy can flip availability. */
export function resetOtelCache(): void {
  cachedApi = undefined;
}

/** Reads a valid thread_id off a RunnableConfig, or undefined if absent/blank. */
export function threadIdOf(config: unknown): string | undefined {
  const raw = (config as { configurable?: { thread_id?: unknown } } | undefined)
    ?.configurable?.thread_id;
  const parsed = threadIdSchema.safeParse(raw);
  return parsed.success ? parsed.data : undefined;
}

function attributes(entries: Record<string, string | undefined>): Attributes {
  const attrs: Attributes = {};
  for (const [key, value] of Object.entries(entries)) {
    if (value !== undefined) attrs[key] = value;
  }
  return attrs;
}

function recordError(api: OtelApi, span: Span, err: unknown): void {
  span.setStatus({
    code: api.SpanStatusCode.ERROR,
    message: err instanceof Error ? err.message : String(err),
  });
  span.recordException(err instanceof Error ? err : String(err));
}

export interface GraphSpanInfo {
  graphName: string;
  threadId?: string;
}

/**
 * Runs a graph invocation inside an active span so every node/tool span created
 * while it executes nests under it. No-op passthrough when OTel is unavailable.
 */
export function withGraphSpan<T>(
  info: GraphSpanInfo,
  fn: () => Promise<T>,
): Promise<T> {
  const api = loadOtel();
  if (!api) return fn();
  const attrs = attributes({
    [ATTR.graphName]: info.graphName,
    [ATTR.threadId]: info.threadId,
  });
  return api.trace
    .getTracer(TRACER_NAME)
    .startActiveSpan(`langgraph.graph ${info.graphName}`, { attributes: attrs }, async (span) => {
      try {
        return await fn();
      } catch (err) {
        recordError(api, span, err);
        throw err;
      } finally {
        span.end();
      }
    });
}

/**
 * Wraps a streamed graph run. The span opens before the underlying stream is
 * created and stays open — with each `next()` executed in the span's context so
 * node/tool spans nest correctly — until the iterator is fully consumed, errors,
 * or is closed early via `return()`/`throw()`.
 */
export async function withGraphStreamSpan<T>(
  info: GraphSpanInfo,
  factory: () => Promise<AsyncIterable<T>>,
): Promise<AsyncIterable<T>> {
  const api = loadOtel();
  if (!api) return factory();

  const attrs = attributes({
    [ATTR.graphName]: info.graphName,
    [ATTR.threadId]: info.threadId,
  });
  const span = api.trace
    .getTracer(TRACER_NAME)
    .startSpan(`langgraph.graph ${info.graphName}`, { attributes: attrs });
  const ctx = api.trace.setSpan(api.context.active(), span);

  let inner: AsyncIterable<T>;
  try {
    inner = await api.context.with(ctx, factory);
  } catch (err) {
    recordError(api, span, err);
    span.end();
    throw err;
  }

  const iterator = inner[Symbol.asyncIterator]();
  let closed = false;
  const finish = (err?: unknown): void => {
    if (closed) return;
    closed = true;
    if (err !== undefined) recordError(api, span, err);
    span.end();
  };

  return {
    [Symbol.asyncIterator](): AsyncIterator<T> {
      return {
        async next(): Promise<IteratorResult<T>> {
          try {
            const res = await api.context.with(ctx, () => iterator.next());
            if (res.done) finish();
            return res;
          } catch (err) {
            finish(err);
            throw err;
          }
        },
        async return(value?: unknown): Promise<IteratorResult<T>> {
          finish();
          if (iterator.return) return iterator.return(value as never);
          return { done: true, value: value as never };
        },
        async throw(err?: unknown): Promise<IteratorResult<T>> {
          finish(err);
          if (iterator.throw) return iterator.throw(err);
          throw err;
        },
      };
    },
  };
}

type NodeRun<TState> = (
  state: TState,
  config?: unknown,
) => unknown | Promise<unknown>;

/**
 * Wraps a node's `run` in a child span named `langgraph.node <id>`. The span
 * inherits whatever graph span is active, and any tool spans created while it
 * runs nest under it. No-op passthrough when OTel is unavailable.
 */
export function instrumentNode<TState>(
  nodeId: string,
  graphName: string,
  run: NodeRun<TState>,
): NodeRun<TState> {
  return (state, config) => {
    const api = loadOtel();
    if (!api) return run(state, config);
    const attrs = attributes({
      [ATTR.nodeName]: nodeId,
      [ATTR.graphName]: graphName,
      [ATTR.threadId]: threadIdOf(config),
    });
    return api.trace
      .getTracer(TRACER_NAME)
      .startActiveSpan(`langgraph.node ${nodeId}`, { attributes: attrs }, async (span) => {
        try {
          return await run(state, config);
        } catch (err) {
          recordError(api, span, err);
          throw err;
        } finally {
          span.end();
        }
      });
  };
}

type ToolFn = (...args: any[]) => unknown | Promise<unknown>;

/**
 * Wraps a bound tool function in a child span named `langgraph.tool <name>`.
 * Runs inside the active `tools` node span, so tool spans nest under it. Tool
 * arguments are never recorded. No-op passthrough when OTel is unavailable.
 */
export function instrumentTool(toolName: string, fn: ToolFn): ToolFn {
  return (...args: any[]) => {
    const api = loadOtel();
    if (!api) return fn(...args);
    return api.trace
      .getTracer(TRACER_NAME)
      .startActiveSpan(
        `langgraph.tool ${toolName}`,
        { attributes: { [ATTR.toolName]: toolName } },
        async (span) => {
          try {
            return await fn(...args);
          } catch (err) {
            recordError(api, span, err);
            throw err;
          } finally {
            span.end();
          }
        },
      );
  };
}

/**
 * Wraps a raw LangChain tool INSTANCE so its `invoke` runs inside a
 * `langgraph.tool <name>` span — the same span a DI-bound tool gets via
 * {@link instrumentTool}. Returns a transparent proxy: every other property and
 * method (including `name`, `schema`, and the prototype chain used by
 * `instanceof`) is forwarded to the original tool, with methods bound to it so
 * private-field access keeps working. The original instance is never mutated.
 */
export function instrumentRawTool<T extends { name: string }>(rawTool: T): T {
  const boundInvoke = (rawTool as unknown as { invoke: ToolFn }).invoke.bind(
    rawTool,
  );
  const wrappedInvoke = instrumentTool(rawTool.name, (...args: any[]) =>
    boundInvoke(...args),
  );
  return new Proxy(rawTool, {
    get(target, prop): unknown {
      if (prop === "invoke") return wrappedInvoke;
      // Read against the real target so getters and private-field access see the
      // original instance, and bind methods to it for the same reason.
      const value = Reflect.get(target, prop, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}
