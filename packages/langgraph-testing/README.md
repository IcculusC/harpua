# @harpua/langgraph-testing

First-class test utilities for graphs built with
[`@harpua/langgraph`](../langgraph). The patterns you'd otherwise hand-roll in
every spec — a deterministic stand-in model, stream collectors, an interrupt
extractor, module boilerplate, a fixed clock — extracted into a small,
composable toolkit. No network, no real LLM, fully deterministic.

## Install

```bash
pnpm add -D @harpua/langgraph-testing
```

Peer dependencies (you already have most from `@harpua/langgraph`):

```bash
pnpm add -D @harpua/langgraph @langchain/core @langchain/langgraph \
  @nestjs/common @nestjs/core @nestjs/testing zod
```

## Test module builder

`createGraphTestingModule` composes `LangGraphModule.forRoot` + `forFeature`
with your providers, creates the Nest app, and `init()`s it — then hands back
typed facade getters, so a spec skips the `createTestingModule` /
`createNestApplication` / `getGraphFacadeToken` dance.

```ts
import { createGraphTestingModule } from "@harpua/langgraph-testing";

const harness = await createGraphTestingModule({
  graphs: [AgentGraph],
  providers: [CallModel, OrderTools, OrderService],
  // checkpointer defaults to memory; opt into a real serialize path:
  // checkpointer: { type: "sqlite", path: ":memory:" },
});

const agent = harness.get(AgentGraph); // typed facade, by class
// harness.getByName("agent"), harness.app, harness.module also available
await harness.close(); // in afterAll — runs checkpointer teardown
```

## Scripted chat model

A deterministic stand-in for a real chat model. `.build()` returns a genuine
`BaseChatModel` subclass (driven with `.invoke()`), so it drops in wherever
LangChain expects a model — a `CallModel`-style node consumes it exactly as it
would a real one, and the agentic loop, tools, and interrupts all run for real.
The built class adds a `reset()` to rewind its script between runs; `bindTools`
is a no-op that returns the model (graphs bind tools at the `ToolNode` level).

**Sequence style** — declare the turns in order:

```ts
import { scriptedModel } from "@harpua/langgraph-testing";

const Model = scriptedModel()
  .toolCall("lookup_order", { id: "42" }) // turn 1: request the tool
  .say("Your order is shipped.") //           turn 2: plain reply
  .build();

// bind it wherever the node injects its model:
providers: [CallModel, { provide: CHAT_MODEL, useClass: Model }];
```

**Rule style** — match on the latest turn (the shape of a `MockChatModel`):

```ts
import { ruleModel, textOf } from "@harpua/langgraph-testing";

const Model = ruleModel()
  .onToolResult((last) => `Here's what I found: ${textOf(last)}`)
  .onHuman(/order\s+#?([A-Za-z0-9-]+)/i, (_text, m) => ({
    toolCalls: [{ name: "lookup_order", args: { id: m[1] } }],
  }))
  .onHuman(/\bcancel\b/i, {
    text: "I need your approval first.",
    additionalKwargs: { pending_action: { action: "cancel_order" } },
  })
  .fallback("Hi! I can check an order for you.")
  .build();
```

## Stream collectors

`collectStream` drains an async iterable into an array;
`collectUntilInterrupt` drains up to the interrupt terminator, splitting the
ordinary chunks from the pending interrupt payload.

```ts
import { collectStream, collectUntilInterrupt } from "@harpua/langgraph-testing";

const chunks = await collectStream(await graph.stream({ steps: [], total: 0 }));
expect(chunks.map((c) => Object.keys(c)[0])).toEqual(["NodeA", "NodeB"]);

const { chunks, interrupts } = await collectUntilInterrupt(
  await hil.streamUpdates({ question: "Name?", answer: "" }, cfg),
);
expect(interrupts?.[0].value).toBe("Name?");
```

## Interrupt helper

`expectInterrupt` asserts a paused `invoke` result and returns the interrupt
payload, typed — throwing a helpful error (naming the result's keys) when the
graph did not actually pause.

```ts
import { expectInterrupt } from "@harpua/langgraph-testing";

const paused = await hil.invoke({ question: "Name?", answer: "" }, cfg);
const question = expectInterrupt<string>(paused);
expect(question).toBe("Name?");
const done = await hil.resume(threadId, "Ada");
```

## Fixed clock

A tiny injectable `Clock` (`now(): Date`) plus a `fixedClock(iso)` factory and a
`provideFixedClock` Nest provider — the determinism rule ("inject clocks, never
bare `new Date()`") as a reusable primitive.

```ts
import { CLOCK, fixedClock, provideFixedClock } from "@harpua/langgraph-testing";

// In a node:
constructor(@Inject(CLOCK) private readonly clock: Clock) {}

// In the test module:
providers: [StampNode, provideFixedClock("2026-07-04T00:00:00Z")];
```
