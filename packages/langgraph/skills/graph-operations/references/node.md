# Adding a node and its edge

A node is an `@Injectable` implementing `NodeHandler<TState>`. It declares **only the slice of state it touches**; the graph's composite state must be a structural superset, checked at compile time. `run(state, config?)` returns a `Partial<TState>` (or a promise of one) — the channels it wrote.

## Steps

1. **Write the node.** Type it against the narrowest state slice it needs — reuse an existing slice interface where possible so the class can be wired into multiple graphs.

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

2. **Register it** in the module's `providers: [...]`. Bootstrap fails fast if an edge references an unprovided node.

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

- Typing the node against the whole graph state when it only touches one channel — over-wide slices block reuse and can fail to compile against narrower graphs.
- Returning the full next state instead of a `Partial<TState>` patch of only the channels written.
- Adding the node to `defineEdges` but not to module `providers` (or vice versa) — bootstrap throws.
- Doing non-idempotent work before `interrupt()`; it re-runs on resume.
- Bare `new Date()` in node logic under test — inject a clock/reference date.
