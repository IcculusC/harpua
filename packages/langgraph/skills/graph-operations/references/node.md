# Adding a node and its edge

> **Writing a `CallModel`-style node that invokes the chat model inside a tools loop?** Stop — the **`@LangGraphAgent`** preset generates that model-calling node, the `TOOLS` node, and the loop (plus turn/token guards and retries) for you. See **`references/agents-and-middleware.md`**. This recipe is for *other* nodes — deterministic steps, custom logic — not the agent's model-calling loop node.

A node is an `@Injectable` implementing `NodeHandler<TState>`. It declares **only the slice of state it touches**; the graph's composite state must be a structural superset, checked at compile time. `run(state, config?)` returns a `Partial<TState>` (or a promise of one) — the channels it wrote.

## Steps

1. **Generate the provider — a node IS a provider.** Run the schematic first; it writes the class file, its spec, and the module `providers: [...]` registration for you (bootstrap fails fast if an edge references an unprovided node, so let the schematic wire it — don't hand-create the file):

```bash
nest g provider <feature>/<node-name> --flat
```

`--flat` drops the file beside its siblings instead of in a per-name subfolder. Expected: `<feature>/<node-name>.ts` (the `@Injectable` class), `<feature>/<node-name>.spec.ts`, and an UPDATE to the feature module. Repo-exact invocation + observed paths: `harpua.md`.

2. **Shape the generated class into a `NodeHandler`.** Type it against the narrowest state slice it needs — reuse an existing slice interface where possible so the class can be wired into multiple graphs.

```ts
@Injectable()
export class CallModel implements NodeHandler<AgentState> {
  constructor(@Inject(CHAT_MODEL) private readonly model: ChatModel) {}

  async run(state: AgentState) {
    const response = await this.model.invoke(state.messages);
    return { messages: [response] };
  }
}
```

3. **Wire the edge** in the graph's `defineEdges<TState>([...])`. Use `route<TState>(fn, [pathMap])` for a conditional target; the pathMap is a closed set validated at bootstrap. Use `as("alias", NodeClass)` to mount the same provider under distinct ids.

```ts
edges = defineEdges<AgentState>([
  { from: START, to: CallModel },
  { from: CallModel, to: route<AgentState>(shouldContinue, [TOOLS, END]) },
  { from: TOOLS, to: CallModel },
]);
```

## Where `interrupt()` fits

Call `interrupt(value)` (re-exported from `@harpua/langgraph`) inside `run()` to pause: `invoke` returns with `__interrupt__` set. On resume the node **re-runs from the top** and `interrupt()` returns the resume value — so keep pre-interrupt work idempotent. Resume via the facade: `graph.resume(threadId, value)`. Interrupts require a checkpointer (every compiled graph has one).

## Tests

Boot with `Test.createTestingModule({ imports: [LangGraphModule.forRoot(), LangGraphModule.forFeature([YourGraph])], providers: [...] })`, get the facade via `@InjectLangGraphRunnable`, `invoke`, and assert resulting state and DI side effects. For an interrupt-bearing node, invoke once to reach the pause, assert `__interrupt__` is set, then `resume` and assert the final state.

## Common Mistakes

- **Inlining a new node class into `chat.graph.ts` (or any existing file) "because the pattern is already there" instead of running `nest g provider`.** A class typed inside the graph-def file is not a DI provider — it never lands in `providers: [...]`, so bootstrap can't resolve the edge that targets it, and you skip the spec the schematic would have written. Generate it as its own provider; shaping the graph-def file is only for the edge list.
- Typing the node against the whole graph state when it only touches one channel — over-wide slices block reuse and can fail to compile against narrower graphs.
- Returning the full next state instead of a `Partial<TState>` patch of only the channels written.
- Adding the node to `defineEdges` but not to module `providers` (or vice versa) — bootstrap throws.
- Doing non-idempotent work before `interrupt()`; it re-runs on resume.
- Bare `new Date()` in node logic under test — inject a clock/reference date.
