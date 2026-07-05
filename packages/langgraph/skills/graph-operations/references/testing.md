# Testing graphs and nodes

## If `@harpua/langgraph-testing` is available, prefer its helpers

When the app dev-depends on `@harpua/langgraph-testing`, reach for it before
hand-rolling the patterns below — it is these recipes, extracted and typed. The
recipes stay as the no-package fallback. API mapping:

| Recipe (below) | Helper |
|---|---|
| 2. Graph e2e boilerplate (`Test.createTestingModule` + `createNestApplication` + `app.init` + `getGraphFacadeToken`) | `createGraphTestingModule({ graphs, providers, imports?, checkpointer? })` → `{ get(GraphClass), getByName(name), app, module, close() }` |
| 3. Scripted model (fake CallModel node) | `scriptedModel().toolCall(name, args).say(text).build()` (sequence) or `ruleModel().onToolResult(...).onHuman(re, ...).fallback(...).build()` (match latest turn); both build an injectable `respond(messages) => AIMessage` |
| 4. Interrupt / resume — asserting `__interrupt__` | `expectInterrupt<T>(result)` returns the payload or throws a helpful error; pairs with the facade's `resume` |
| 5. Streaming — the local `collect` + terminator detection | `collectStream(iterable)`; `collectUntilInterrupt(iterable)` → `{ chunks, interrupts }` |
| 6. Real persistence | pass `checkpointer: { type: "sqlite", path: ":memory:" }` to `createGraphTestingModule` |
| 7. Determinism | `fixedClock(iso)` / `provideFixedClock(iso)` + the `CLOCK` token |

See that package's README for one snippet per helper. The rest of this file is
the framework-generic fallback for when the package is not installed.

## 1. Unit-test a node (no graph)

A node is a plain provider. Instantiate it via `Test.createTestingModule` with its
real deps (or mocks), call `run(state)` with a state literal, assert the partial patch.

```ts
const ref = await Test.createTestingModule({
  providers: [NodeA, IncrementService],
}).compile();
const node = ref.get(NodeA);
expect(node.run({ steps: [], total: 0 })).toEqual({ steps: ["A"], total: 1 });
```

## 2. Graph end-to-end

Boot a module, get the facade, invoke, assert final state.

```ts
const ref = await Test.createTestingModule({
  imports: [
    LangGraphModule.forRoot({ checkpointer: { type: "memory" } }),
    LangGraphModule.forFeature([LinearGraph]),
  ],
  providers: [NodeA, NodeB, IncrementService],
}).compile();
const app = ref.createNestApplication();
await app.init();
const graph = app.get<LangGraphRunnable>(getGraphFacadeToken({ name: "linear" }));
const result = await graph.invoke({ steps: [], total: 0 });
expect(result.steps).toEqual(["A", "B"]);
```

Inject the facade with `@InjectLangGraphRunnable(GraphClass)` in a consumer provider,
or `app.get(getGraphFacadeToken({ name }))`. Always `await app.close()` in `afterAll`.

## 3. Scripted model (drives real agentic loops, zero LLM)

A fake model node emits an `AIMessage` with synthetic `tool_calls` on the first pass,
then a plain `AIMessage` once a `ToolMessage` is present. Real tools run through DI.

```ts
@Injectable()
class CallModel implements NodeHandler<MsgState> {
  run(state: MsgState) {
    const last = state.messages[state.messages.length - 1];
    if (last instanceof ToolMessage) {
      return { messages: [new AIMessage("Your order is shipped.")] };
    }
    return {
      messages: [new AIMessage({
        content: "",
        tool_calls: [{ name: "lookup_order", args: { id: "42" }, id: "call_1", type: "tool_call" }],
      })],
    };
  }
}
```

Assert the real tool ran (`expect(orderService.calls).toContain("42")`) and the final
message is the plain reply. A model that always emits `tool_calls` exercises `recursionLimit`.

## 4. Interrupt / resume

Pass an explicit `thread_id` (resume needs the same one). Invoke to the pause, assert
`__interrupt__`, `resume`, assert completion.

```ts
const cfg = { configurable: { thread_id: "t1" } };
const paused = await hil.invoke({ question: "Name?", answer: "" }, cfg);
expect((paused as any).__interrupt__).toBeDefined();
const done = await hil.resume("t1", "Ada");
expect(done.answer).toBe("Ada");
```

Two invokes on one thread also prove persistence: `getState(cfg)` between them shows the
pending run; after resume the same thread reads back the final value.

## 5. Streaming assertions

Collect the `AsyncIterable`, assert the update sequence; detect the terminator.

```ts
async function collect<T>(s: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = []; for await (const c of s) out.push(c); return out;
}
const chunks = await collect(await graph.stream({ steps: [], total: 0 }));
expect(chunks.map((c) => Object.keys(c)[0])).toEqual(["NodeA", "NodeB"]);
```

An interrupted stream emits one final chunk then ends — detect it with
`getStreamedInterrupts(lastChunk)`, then `resume`.

## 6. Real persistence without servers

`{ type: "sqlite", path: ":memory:" }` gives genuine cross-invoke persistence via the
real serialization path (call `app.enableShutdownHooks()` so the db closes). The memory
saver also persists within one process, but sqlite exercises serialize/deserialize.

## 7. Determinism

Inject a clock or reference date into node deps; never call bare `new Date()` in logic
under test. A scripted model (recipe 3) removes the other big nondeterminism source.

## 8. Type-level tests

Assert compile-time guarantees (edge/state compatibility) with `@ts-expect-error` in a
`*.type-spec.ts` file, a dedicated `tsconfig` (`noEmit`, excludes `*.spec.ts`), and a
`*.spec.ts` that shells out to `tsc`:

```ts
it("compiles cleanly (rejections hold)", () => {
  execFileSync("npx", ["tsc", "-p", "tsconfig.type-test.json"], { cwd: pkgRoot, stdio: "pipe" });
});
```

tsc exits 0 only if every `@ts-expect-error` still catches a real error.

## Iteration loop

Run one spec while iterating: `<pm> exec jest path/to.spec.ts -t 'pattern'`. Full-suite
verification is your project's own protocol, not a single green spec.
