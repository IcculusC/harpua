# Adding a tool

A tool is a method decorated with `@LangGraphTool` on any `@Injectable`. At bootstrap the library resolves each provider listed in `@LangGraph({ tools: [...] })` from DI, **auto-collects every `@LangGraphTool` method on it**, wraps each with `tool(...)`, and mounts them as one `ToolNode` under the `TOOLS` sentinel.

## Decide: new method vs new provider

- **Adding a method to a class already in some graph's `tools` array**: just add the method. It is auto-collected — **zero** graph, module, or edge wiring. This is the common case; don't re-derive it.
- **Adding a new tool provider class**: add the class to (a) that graph's `tools: [...]` array and (b) the module's `providers: [...]`. Providers aren't auto-scanned from the filesystem; each must be DI-resolvable.

## Steps (new method on an existing provider)

1. Add the method to the provider.
2. Give it a zod `schema`; `describe()` each field the model must fill.
3. The method receives the parsed input object and returns a `string` (the tool result). Inject dependencies through the constructor — they resolve via Nest DI on the live instance.

```ts
@Injectable()
export class WeatherTools {
  constructor(private readonly forecast: ForecastService) {}

  @LangGraphTool({
    name: "get_weather",
    description: "Call to get the current weather.",
    schema: z.object({ location: z.string().describe("Location to get the weather for.") }),
  })
  getWeather(input: { location: string }): string {
    return this.forecast.lookup(input.location);
  }
}
```

## Mounting a raw LangChain tool

A `tools` entry may also be a raw LangChain tool INSTANCE — anything from
`tool(...)` in `@langchain/core/tools` — not just a provider class. Raw tools are
mounted into the same `ToolNode` as-is, mixed freely with provider classes, and
get the same `langgraph.tool <name>` tracing. This is how you drop in prebuilt
tools that carry no DI dependency, such as [`@harpua/agent-tools`](https://www.npmjs.com/package/@harpua/agent-tools)'
`thinkTool()`.

```ts
import { thinkTool } from "@harpua/agent-tools";

@LangGraph({ name: "agent", state: AgentState, tools: [OrderTools, thinkTool()] })
export class AgentGraph { /* … */ }
```

Use a provider class when the tool needs DI (services, config, a repository);
use a raw instance for self-contained tools with no dependencies. An entry that
is neither a decorated provider class nor a raw tool instance fails fast at
bootstrap.

## Tests

- **Unit**: instantiate the provider directly (or via `Test.createTestingModule`) and assert the method's return, plus that its injected service was hit.
- **Integration**: boot `LangGraphModule.forRoot()` + `forFeature([YourGraph])` in a `Test.createTestingModule`, invoke the graph with input that should trigger the tool call, and assert both the reply and the injected service's side effect — this proves the tool ran through DI, not just that the method works in isolation.

## Common Mistakes

- Wiring the graph/module when you only added a method to an already-listed provider. It's auto-collected — no wiring needed. (Don't spend a long exploration rediscovering this; it's the rule above.)
- Adding a new tool provider but forgetting to list it in both `tools: [...]` and module `providers`. Bootstrap fails fast: "listed tool provider isn't provided in any module."
- Bare `new Date()` in tool logic under test — inject a clock instead.
- Stopping at a unit test when the project has an integration/e2e layer that exercises the same tool end to end through the graph.
