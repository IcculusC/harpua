# Adding a tool

A tool is a method decorated with `@LangGraphTool` on any `@Injectable`. At bootstrap the library resolves each provider listed in `@LangGraph({ tools: [...] })` from DI, **auto-collects every `@LangGraphTool` method on it**, wraps each with `tool(...)`, and mounts them as one `ToolNode` under the `TOOLS` sentinel.

## Decide: new method vs new provider

- **Adding a method to a class already in some graph's `tools` array** (e.g. `OrderTools`): just add the method. It is auto-collected — **zero** graph, module, or edge wiring. This is the common case; don't re-derive it.
- **Adding a new tool provider class**: add the class to (a) that graph's `tools: [...]` array and (b) the module's `providers: [...]`. Provider isn't auto-scanned from the filesystem; it must be DI-resolvable.

## Steps (new method on an existing provider)

1. Add the method to the provider (exemplar: `apps/api/src/chat/order.tools.ts`).
2. Give it a zod `schema`; `describe()` each field the model must fill.
3. The method receives the parsed input object and returns a `string` (the tool result). Inject dependencies through the constructor — they resolve via Nest DI on the live instance.

```ts
// apps/api/src/chat/order.tools.ts
@Injectable()
export class OrderTools {
  constructor(private readonly orders: OrdersService) {}

  @LangGraphTool({
    name: "cancel_order",
    description: "Cancel an order by its id",
    schema: z.object({ orderId: z.string().describe("Order id to cancel") }),
  })
  cancelOrder(input: { orderId: string }): string {
    return this.orders.cancel(input.orderId);
  }
}
```

## If the tool is user-facing in the chat demo

The demo model is the deterministic `MockChatModel` (`apps/api/src/chat/mock-chat-model.ts`), not a real LLM. It will never call a new tool until you teach it to. You MUST:

1. Add routing in `respond()` so some input emits a `tool_calls` AIMessage with `name` matching your tool (mirror the existing `lookup_order` branch and its `/order\s+#?([A-Za-z0-9-]+)/i` regex).
2. **Update the canned capability/help reply** (the final `return new AIMessage('Hi! I can check an order…')`) to mention the new capability. Baseline agents forget this and the help text goes stale.

## Tests

- **Unit**: instantiate the provider (or `Test.createTestingModule`) and assert the method's return, plus that its injected service was hit. Exemplar for a tool exercised end-to-end through the graph: `packages/langgraph/src/__tests__/agentic.spec.ts` (asserts `orderService.calls` to prove the tool ran via DI).
- **e2e**: drive it through the HTTP surface as in `apps/api/src/chat/chat.e2e.spec.ts` — post a message that triggers the tool call, assert the reply text and the DI side effect (`orders.lookups`).

## Common Mistakes

- Wiring the graph/module when you only added a method to an already-listed provider. It's auto-collected — no wiring needed. (Don't spend a long exploration rediscovering this; it's the rule above.)
- Adding a new tool provider but forgetting to list it in both `tools: [...]` and module `providers`. Bootstrap fails fast: "listed tool provider isn't provided in any module."
- Shipping a demo tool without updating `MockChatModel` routing AND its help text — the tool is dead code the demo never reaches.
- Verifying with `pnpm --filter @harpua/api test` instead of the root protocol `pnpm turbo build lint test --force`.
- Bare `new Date()` in tool logic under test — inject a clock instead.
