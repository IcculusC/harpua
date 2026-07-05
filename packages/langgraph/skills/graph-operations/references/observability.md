# Observability: OpenTelemetry tracing

Framework-generic. Compiled graphs emit OpenTelemetry spans through
`@opentelemetry/api` **only**. That package is a no-op until an OTel SDK is
registered in the host process, so instrumentation is always-on and costs
nothing until someone wires up a `TracerProvider`. If `@opentelemetry/api` is
not installed at all, the library degrades silently to zero instrumentation —
there is nothing to configure and no error to handle.

## Span hierarchy

One span per graph run wraps a child span per node, which in turn parents a
span per observable tool call:

```
langgraph.graph <graphName>          (one per invoke / stream)
├─ langgraph.node <nodeId>           (one per node execution)
│  └─ langgraph.tool <toolName>      (only under the built-in `tools` node)
└─ langgraph.node tools              (the ToolNode runs as a node named `tools`)
   └─ langgraph.tool <toolName>
```

- `invoke` opens an **active** span, so nodes/tools running inside it nest
  automatically via OTel context propagation.
- `stream`/`streamValues`/`streamUpdates`/`streamMessages`/`streamModes` open the
  graph span before the underlying stream starts and keep it **open until the
  async iterator is fully consumed, errors, or is closed early** (`break` /
  `return()`). Each `next()` runs in the graph span's context so per-super-step
  node spans still nest correctly.
- Tool spans only appear under the `tools` node span. A user node that happens
  to call a tool directly is just a normal node span.

### Attributes (stable, low-cardinality)

| Key | On | Value |
|---|---|---|
| `langgraph.graph.name` | graph, node | the `@LangGraph({ name })` |
| `langgraph.node.name` | node | the node id (class name, alias, or `tools`) |
| `langgraph.tool.name` | tool | the tool's registered name |
| `langgraph.thread_id` | graph, node | the run's `thread_id`, when present |

**Message contents and tool arguments are never recorded** — they are PII- and
size-sensitive. Only the names/ids above go on spans.

### Error semantics

A node, tool, or graph failure sets the span status to `ERROR`, records the
exception as a span event, and rethrows — the error still propagates to the
caller unchanged.

## Enabling it in an app

Instrumentation is dormant until you register an SDK at process start
(**before** the Nest app boots, so the global provider is live when graphs run):

```ts
// tracing.ts — import this first in main.ts, before anything else.
import { NodeSDK } from "@opentelemetry/sdk-node";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";

const sdk = new NodeSDK({
  traceExporter: new OTLPTraceExporter({ url: "http://localhost:4318/v1/traces" }),
});
sdk.start();
```

```ts
// main.ts
import "./tracing";
import { NestFactory } from "@nestjs/core";
// ...
```

Install the SDK packages in the app (the library only needs `@opentelemetry/api`):

```bash
pnpm add @opentelemetry/api @opentelemetry/sdk-node @opentelemetry/exporter-trace-otlp-http
```

## Langfuse

Langfuse support falls out of plain OTel — there is **no** Langfuse code or
dependency in the library. Register Langfuse's span processor on your own SDK:

```bash
pnpm add @langfuse/otel
```

```ts
import { NodeSDK } from "@opentelemetry/sdk-node";
import { LangfuseSpanProcessor } from "@langfuse/otel";

const sdk = new NodeSDK({
  spanProcessors: [new LangfuseSpanProcessor()], // reads LANGFUSE_* env vars
});
sdk.start();
```

Every `langgraph.graph` / `langgraph.node` / `langgraph.tool` span then shows up
as a Langfuse trace/observation with no further wiring.

## Testing spans (deterministic, offline)

Use `@opentelemetry/sdk-trace-node` with an `InMemorySpanExporter` — no network,
no collector. Register the provider before running the graph, then assert on the
finished spans:

```ts
import { context, trace } from "@opentelemetry/api";
import {
  InMemorySpanExporter,
  NodeTracerProvider,
  SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-node";

const exporter = new InMemorySpanExporter();
const provider = new NodeTracerProvider({
  spanProcessors: [new SimpleSpanProcessor(exporter)],
});
provider.register(); // installs the AsyncLocalStorage context manager too

// ...run graph.invoke(...) / consume a stream...

const spans = exporter.getFinishedSpans();
const graph = spans.find((s) => s.name === "langgraph.graph myGraph")!;
const node = spans.find((s) => s.name === "langgraph.node MyNode")!;

// Parentage: a finished span carries its parent under `parentSpanContext`.
expect(node.parentSpanContext?.spanId).toBe(graph.spanContext().spanId);
expect(graph.attributes["langgraph.graph.name"]).toBe("myGraph");

// Teardown between suites.
await provider.shutdown();
trace.disable();
context.disable();
```

Notes:
- `SimpleSpanProcessor` exports a span on `end()` — so a span only appears in
  `getFinishedSpans()` once it has closed. Streaming graph spans therefore stay
  absent from that list until the iterator is drained, which is exactly how you
  assert "the graph span stays open for the whole stream".
- `provider.register()` installs an `AsyncLocalStorageContextManager`; without a
  context manager `startActiveSpan` cannot nest children.
- To assert the no-op path (SDK absent), stub the module loader so
  `@opentelemetry/api` resolves as `MODULE_NOT_FOUND` and confirm the run still
  succeeds and emits zero spans.
