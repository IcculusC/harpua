# Debugging @harpua/langgraph

Framework-generic. Grep the error you hit, or jump to a section.

## Bootstrap error decoder

Thrown at app boot (graph compile). Match the substring, apply the fix.

| Error substring | Fix |
|---|---|
| `is not a @LangGraph-decorated class` | Add `@LangGraph({ name, state })` to the class. |
| `must expose an 'edges' array (use defineEdges)` | Add `edges = defineEdges<StateT>([...])`. |
| `is referenced by graph '...' but not provided in any module` | Add the node class to a module's `providers`. |
| `does not implement NodeHandler.run()` | Implement `run(state, config?)` on the node. |
| `is not resolvable from DI. Register it via LangGraphModule.forFeature` | Pass the graph class to `forFeature([...])`. |
| `Duplicate node id '...': maps to two different targets. Use as()` | Wrap one target with `as("distinctId", Node)`. |
| `references the TOOLS node but no tool providers were configured` | Add `tools: [Provider]` to `@LangGraph`. |
| `lists tool providers but none expose @LangGraphTool methods` | Decorate a method with `@LangGraphTool({...})`. |
| `is listed by graph '...' but not provided in any module` | Add the tool provider to `providers`. |
| `invalid ... edge reference` / `unknown route/interrupt target` | Use a valid node/alias/subgraph/`START`/`END`/`TOOLS` ref. |
| `Circular subgraph reference detected` | Break the subgraph cycle. |
| `No compiled graph for '...'. Was it registered via LangGraphModule.forFeature and did bootstrap complete?` | Register via `forFeature`; don't call the facade before `app.init()`. |
| `this checkpointer needs the optional peer '...', which is not installed` | Run the `pnpm add ...` the error prints. |
| `unknown checkpointer config` | Use a valid `type`: `memory`/`sqlite`/`postgres`/`mongodb`/`redis`. |

## Runtime issues

**`GraphRecursionError: Recursion limit of N reached without hitting a stop
condition`** — ran N super-steps without reaching `END` (a route that never
returns `END`, or a tool loop). Default limit **25**. Set a per-graph default via
`@LangGraph({ recursionLimit })`; a caller's `config.recursionLimit` always wins
(the facade merges its default only when the caller omits one). Raising it
hides logic bugs — inspect history first.

**Interrupt won't resume** — resuming needs the SAME `thread_id` the interrupt
was created on. If you called `invoke`/`stream` WITHOUT a `thread_id`, the facade
auto-generated an ephemeral one and that checkpoint is unreachable — it **can
never be resumed**. Always pass an explicit `thread_id` for human-in-the-loop.

**Stream "ends early"** — an interrupted stream emits one final chunk
`{ __interrupt__: StreamInterrupt[] }` then ends. That's the terminator, not a
crash. Detect with `getStreamedInterrupts(chunk)`, then `resume(...)`.

**State not persisting across calls** — no `thread_id` passed, so each call got a
fresh ephemeral thread. Pass `{ configurable: { thread_id } }`.

## State inspection & time travel (via the library)

The facade is your first debugger — no store needed.

```ts
const cfg = { configurable: { thread_id } };

// Current state: values, next nodes, pending tasks/interrupts.
const snap = await graph.getState(cfg);
snap.values; snap.next; snap.tasks; // tasks[].interrupts = interrupt payloads

// Full history, NEWEST FIRST. Each snapshot's config carries a checkpoint_id.
for await (const s of graph.getStateHistory(cfg)) {
  console.log(s.config.configurable.checkpoint_id, s.next, s.values);
}

// Time travel: replay/fork from a historical checkpoint_id.
await graph.invoke(null, { configurable: { thread_id, checkpoint_id } });

// Edit state as if a node produced it, then continue.
await graph.updateState(cfg, { field: "value" }, "NodeName");
await graph.invoke(null, cfg);
```

The loop: `getStateHistory` → pick a `checkpoint_id` → `invoke` with it to
fork/replay, or `updateState` to correct state before resuming.

## Inspecting the checkpoint store directly

When the facade isn't enough (finding threads across runs):

- **postgres** → `debugging-postgres.md`
- **redis** → `debugging-redis.md`
