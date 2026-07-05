import type { INestApplication, Provider, Type } from "@nestjs/common";
import { Test, type TestingModule } from "@nestjs/testing";
import {
  LangGraphModule,
  getGraphFacadeToken,
  getGraphMetadata,
  type CheckpointerOptions,
  type LangGraphRunnable,
} from "@harpua/langgraph";

/** Configuration for {@link createGraphTestingModule}. */
export interface GraphTestingModuleConfig {
  /** `@LangGraph`-decorated graph classes to register via `forFeature`. */
  graphs: Type<any>[];
  /** Node, tool, model and support providers the graphs resolve through DI. */
  providers?: Provider[];
  /** Extra modules to import (e.g. a config module the providers need). */
  imports?: any[];
  /**
   * Checkpointer backing the graphs. Defaults to the in-memory saver; pass
   * `{ type: "sqlite", path: ":memory:" }` to opt into a real serialize/
   * deserialize path (closed automatically on {@link GraphTestingHarness.close}).
   */
  checkpointer?: CheckpointerOptions;
}

/** A booted testing module plus typed accessors for its graph facades. */
export interface GraphTestingHarness {
  /** The compiled Nest testing module (for `module.get(...)` of any provider). */
  module: TestingModule;
  /** The initialized application (for `app.get(...)` and lifecycle control). */
  app: INestApplication;
  /** Get a graph's runnable facade by its `@LangGraph`-decorated class. */
  get<TState = any>(graph: Type<any>): LangGraphRunnable<TState>;
  /** Get a graph's runnable facade by its declared name. */
  getByName<TState = any>(name: string): LangGraphRunnable<TState>;
  /** Shut the app down, running checkpointer teardown. Call in `afterAll`. */
  close(): Promise<void>;
}

/**
 * Boots a Nest testing module wired for graphs in one call: it composes
 * `LangGraphModule.forRoot` (memory checkpointer by default) + `forFeature`
 * with your providers, creates the application, and `init()`s it — then hands
 * back typed facade getters so a spec skips the `createTestingModule` /
 * `createNestApplication` / `getGraphFacadeToken` boilerplate.
 *
 * @example
 * ```ts
 * const harness = await createGraphTestingModule({
 *   graphs: [AgentGraph],
 *   providers: [CallModel, OrderTools, OrderService],
 * });
 * const agent = harness.get(AgentGraph);
 * const result = await agent.invoke({ messages: [new HumanMessage("hi")] });
 * // ...
 * await harness.close();
 * ```
 */
export async function createGraphTestingModule(
  config: GraphTestingModuleConfig,
): Promise<GraphTestingHarness> {
  const checkpointer: CheckpointerOptions = config.checkpointer ?? {
    type: "memory",
  };

  const module = await Test.createTestingModule({
    imports: [
      ...(config.imports ?? []),
      LangGraphModule.forRoot({ checkpointer }),
      LangGraphModule.forFeature(config.graphs),
    ],
    providers: config.providers ?? [],
  }).compile();

  const app = module.createNestApplication();
  await app.init();

  const tokenFor = (graph: Type<any>): string => {
    const meta = getGraphMetadata(graph);
    if (!meta) {
      throw new Error(
        `createGraphTestingModule: ${
          (graph as { name?: string })?.name ?? String(graph)
        } is not a @LangGraph-decorated class`,
      );
    }
    return getGraphFacadeToken(meta);
  };

  return {
    module,
    app,
    get: <TState = any>(graph: Type<any>) =>
      app.get<LangGraphRunnable<TState>>(tokenFor(graph)),
    getByName: <TState = any>(name: string) =>
      app.get<LangGraphRunnable<TState>>(getGraphFacadeToken({ name })),
    close: () => app.close(),
  };
}
