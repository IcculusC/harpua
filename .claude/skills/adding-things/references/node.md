# Adding a node and its edge

A node is an `@Injectable` implementing `NodeHandler<TState>`. It declares **only the slice of state it touches**; the graph's composite state must be a structural superset, checked at compile time. `run(state, config?)` returns a `Partial<TState>` (or a promise of one) — the channels it wrote.

## Steps

1. **Write the node.** Type it against the narrowest state slice it needs — reuse an existing slice interface where possible so the class can be wired into multiple graphs. Exemplars: `apps/api/src/chat/chat.graph.ts` (`CallModelNode`, `ApprovalNode`), `packages/langgraph/src/__tests__/fixtures.ts` (`NodeA`, `LogStamp`).

```ts
@Injectable()
export class ApprovalNode implements NodeHandler<ChatState> {
  constructor(private readonly orders: OrdersService) {}

  run(state: ChatState) {
    const decision = interrupt({ type: "approval_request", /* … */ });
    const approved = decision === true;
    return { messages: [new AIMessage(approved ? this.orders.cancel(id) : "No changes made.")] };
  }
}
```

2. **Register it** in the module's `providers: [...]` (e.g. `apps/api/src/chat/chat.module.ts`). Bootstrap fails fast if an edge references an unprovided node.

3. **Wire the edge** in the graph's `defineEdges<TState>([...])`. Use `route<TState>(fn, [pathMap])` for a conditional target; the pathMap is a closed set validated at bootstrap. Use `as("alias", NodeClass)` to mount the same provider under distinct ids.

```ts
edges = defineEdges<ChatState>([
  { from: START, to: CallModelNode },
  { from: CallModelNode, to: route<ChatState>(routeAfterModel, [TOOLS, ApprovalNode, END]) },
  { from: TOOLS, to: CallModelNode },
  { from: ApprovalNode, to: END },
]);
```

## Where `interrupt()` fits

Call `interrupt(value)` (re-exported from `@harpua/langgraph`) inside `run()` to pause: `invoke` returns with `__interrupt__` set. On resume the node **re-runs from the top** and `interrupt()` returns the resume value — so keep pre-interrupt work idempotent. Resume via the facade: `graph.resume(threadId, value)`. Interrupts require a checkpointer (every compiled graph has one).

## Tests

Model on the library's `__tests__` fixtures + spec pairing: define the node/graph in a fixtures-style module, boot with `Test.createTestingModule({ imports: [LangGraphModule.forRoot(), LangGraphModule.forFeature([Graph])], providers: [...] })`, get the facade, `invoke`, assert resulting state and DI side effects. See `packages/langgraph/src/__tests__/linear.spec.ts` (state flow + DI) and `interrupt.spec.ts` (pause/resume). For the chat demo, drive HTTP as in `chat.e2e.spec.ts`.

## Common Mistakes

- Typing the node against the whole graph state when it only touches one channel — over-wide slices block reuse and can fail to compile against narrower graphs.
- Returning the full next state instead of a `Partial<TState>` patch of only the channels written.
- Adding the node to `defineEdges` but not to module `providers` (or vice versa) — bootstrap throws.
- Doing non-idempotent work before `interrupt()`; it re-runs on resume.
- Verifying per-package instead of the root protocol `pnpm turbo build lint test --force`.
- Bare `new Date()` in node logic under test — inject a clock/reference date.
