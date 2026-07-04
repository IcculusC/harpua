# Streaming a graph

Framework-generic. `invoke` runs to completion; streaming observes the run
super-step by super-step. Every facade helper returns
`Promise<AsyncIterable<…>>`, so the shape is
`for await (const chunk of await graph.streamX(input, cfg))`.

## Choosing a mode

The compiled graph's default is **`updates`** — what plain `stream` uses when
you pass no mode.

| Want | Helper | Mode | Chunk shape |
|---|---|---|---|
| Per-node deltas (progress UI) | `stream` / `streamUpdates` | `updates` | `{ [nodeId]: Partial<TState> }`, one per super-step |
| Full snapshot after each step | `streamValues` | `values` | the whole `TState` (starts with the input state) |
| LLM message/token chunks | `streamMessages` | `messages` | `[BaseMessage, metadata]` |
| Several at once | `streamModes` | any combination | `[mode, chunk]` discriminated tuples |

The full v1 (1.4.7) `streamMode` set is
`values | updates | messages | custom | debug | checkpoints | tasks | tools`.
The three helpers cover the everyday three; `streamModes(input, [...], cfg)`
gives typed access to any combination.

## Helpers and yield shapes

```ts
for await (const u of await agent.stream(input, cfg))       // { CallModel: { messages: [AIMessage] } }
for await (const s of await agent.streamValues(input, cfg)) // whole TState
for await (const [msg, meta] of await agent.streamMessages(input, cfg))
for await (const c of await agent.streamModes(input, ["updates", "values"], cfg))
```

## SSE controller recipe

`@Sse` is **GET-based** in Nest, so the user message rides in as a query param.
Map each node update to a **named event** (event name = node id) and end with one
**terminal `final` event** carrying the assistant text or the interrupt payload:

```ts
@Sse(":threadId/stream")
stream(@Param("threadId") threadId, @Query("message") message): Observable<MessageEvent> {
  return from(this.chat.streamTurn(threadId, message)).pipe(
    map((e) => e.kind === "final"
      ? { type: "final", data: JSON.stringify({ messages: e.messages, ...(e.interrupt !== undefined ? { interrupt: e.interrupt } : {}) }) }
      : { type: e.node, data: JSON.stringify({ node: e.node, messages: e.messages }) }),
  );
}
```

The service generator yields one event per node, then exactly one `final`.

## Consuming multi-mode tuples

`streamModes` yields `[mode, chunk]`; discriminate on the leading literal:

```ts
for await (const chunk of await agent.streamModes(input, ["updates", "values"], cfg)) {
  if (chunk[0] === "values") { /* chunk[1]: TState */ }
  else { /* chunk[1]: NodeUpdate<TState> */ }
}
```

## Interrupt terminator mid-stream

An interrupted run doesn't throw and doesn't silently stop — it emits one final
chunk `{ __interrupt__: StreamInterrupt[] }` (in both `updates` and `values`
mode) then ends. Detect it, stash the value, break:

```ts
for await (const chunk of await agent.streamUpdates(input, cfg)) {
  const interrupts = getStreamedInterrupts(chunk);
  if (interrupts) { pending = interrupts[0].value; break; }
  // ...normal update
}
```

Surface `pending` on your terminal event, then `resume(threadId, decision)`.

## messages mode needs a real model

Token-level granularity in `messages` mode requires a real **streaming** chat
model. A node that returns a whole `AIMessage` (or a deterministic mock) still
surfaces it as a single chunk — fine for per-node progress via `updates`, but no
token stream. Reach for `streamMessages` only against a streaming LLM.
