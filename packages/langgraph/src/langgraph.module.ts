import {
  Global,
  Module,
  type DynamicModule,
  type Provider,
  type Type,
} from "@nestjs/common";
import { ModuleRef } from "@nestjs/core";
import type { BaseCheckpointSaver } from "@langchain/langgraph";

import {
  LANGGRAPH_CHECKPOINTER,
  LANGGRAPH_MODULE_OPTIONS,
  getGraphFacadeToken,
} from "./constants";
import { getGraphMetadata } from "./decorators";
import { GraphRegistry } from "./graph-registry";
import { GraphFacade } from "./graph-facade";
import { buildCheckpointer, CheckpointerLifecycle } from "./checkpointer";
import { getAgentMetadata } from "./agent/agent.decorator";
import { agentProviders } from "./agent/agent-compiler";
import type {
  CheckpointerOptions,
  LangGraphModuleAsyncOptions,
  LangGraphModuleOptions,
} from "./interfaces";

function checkpointerProvider(): Provider {
  return {
    provide: LANGGRAPH_CHECKPOINTER,
    // Runs during DI resolution — before GraphRegistry.onApplicationBootstrap
    // compiles any graph — so async schema setup completes before compile.
    useFactory: async (
      options: LangGraphModuleOptions,
      moduleRef: ModuleRef,
      lifecycle: CheckpointerLifecycle,
    ): Promise<BaseCheckpointSaver> => {
      const cfg: CheckpointerOptions = options?.checkpointer ?? {
        type: "memory",
      };
      const built = await buildCheckpointer(cfg, moduleRef);
      if (built.teardown) lifecycle.register(built.teardown);
      return built.saver;
    },
    inject: [LANGGRAPH_MODULE_OPTIONS, ModuleRef, CheckpointerLifecycle],
  };
}

/**
 * Global module wiring the checkpointer and the {@link GraphRegistry}. Feature
 * modules register graph definitions and injectable facades via `forFeature`.
 */
@Global()
@Module({})
export class LangGraphModule {
  static forRoot(options: LangGraphModuleOptions = {}): DynamicModule {
    return {
      module: LangGraphModule,
      providers: [
        { provide: LANGGRAPH_MODULE_OPTIONS, useValue: options },
        CheckpointerLifecycle,
        checkpointerProvider(),
        GraphRegistry,
      ],
      exports: [LANGGRAPH_CHECKPOINTER, GraphRegistry],
    };
  }

  static forRootAsync(options: LangGraphModuleAsyncOptions): DynamicModule {
    return {
      module: LangGraphModule,
      imports: options.imports ?? [],
      providers: [
        {
          provide: LANGGRAPH_MODULE_OPTIONS,
          useFactory: options.useFactory,
          inject: options.inject ?? [],
        },
        CheckpointerLifecycle,
        checkpointerProvider(),
        GraphRegistry,
      ],
      exports: [LANGGRAPH_CHECKPOINTER, GraphRegistry],
    };
  }

  /**
   * Registers graph definition classes as providers and creates one injectable
   * facade provider per graph (retrievable via `@InjectLangGraphRunnable`).
   *
   * `options.providers` are merged into THIS SAME `DynamicModule` instance —
   * not the caller's own module — which matters for any `@LangGraphAgent`
   * `middleware` that takes constructor-injected config (e.g. `provideBudget`/
   * `provideRetry`'s `BUDGET_OPTS`/`RETRY_OPTS`). `agentProviders` auto-registers
   * a `middleware: [...]` class into this DynamicModule's own provider list so
   * the generated hook/wrap nodes can resolve it; standard Nest module
   * encapsulation means that auto-registered copy CANNOT see providers declared
   * in the caller's module (imports only expose a module's *exports* to its
   * *importers*, never the reverse) even though a flat sibling registration in
   * the caller's own `providers` array looks like it should be in scope. Pass
   * the middleware's options providers here so they land in the same module the
   * middleware class itself is instantiated in.
   */
  static forFeature(
    graphDefs: Type<any>[],
    options: { providers?: Provider[] } = {},
  ): DynamicModule {
    const providers: Provider[] = [...(options.providers ?? [])];
    const exports: any[] = [];

    for (const def of graphDefs) {
      const meta = getGraphMetadata(def);
      if (!meta) {
        throw new Error(
          `LangGraphModule.forFeature: ${
            (def as { name?: string })?.name ?? String(def)
          } is not a @LangGraph-decorated class`,
        );
      }
      const facadeToken = getGraphFacadeToken(meta);

      // The graph definition class itself (so DI can resolve its edges).
      providers.push(def);

      // A `@LangGraphAgent` preset also needs its generated nodes, its
      // middleware classes, and its internal bound-model provider registered.
      if (getAgentMetadata(def)) {
        providers.push(...agentProviders(def));
      }

      // Facade provider; also registers the graph with the registry so that
      // the registry compiles it at bootstrap even if the facade is never
      // injected (singleton useFactory providers are instantiated eagerly).
      providers.push({
        provide: facadeToken,
        useFactory: (registry: GraphRegistry) => {
          registry.register(def);
          return new GraphFacade(registry, def);
        },
        inject: [GraphRegistry],
      });

      exports.push(facadeToken);
    }

    return {
      module: LangGraphModule,
      providers,
      exports,
    };
  }
}
