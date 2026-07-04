import {
  Global,
  Module,
  type DynamicModule,
  type Provider,
  type Type,
} from "@nestjs/common";
import { ModuleRef } from "@nestjs/core";
import { MemorySaver } from "@langchain/langgraph";
import type { BaseCheckpointSaver } from "@langchain/langgraph";

import {
  LANGGRAPH_CHECKPOINTER,
  LANGGRAPH_MODULE_OPTIONS,
  getGraphFacadeToken,
} from "./constants";
import { getGraphMetadata } from "./decorators";
import { GraphRegistry } from "./graph-registry";
import { GraphFacade } from "./graph-facade";
import type {
  CheckpointerOptions,
  LangGraphModuleAsyncOptions,
  LangGraphModuleOptions,
} from "./interfaces";

function checkpointerProvider(): Provider {
  return {
    provide: LANGGRAPH_CHECKPOINTER,
    useFactory: async (
      options: LangGraphModuleOptions,
      moduleRef: ModuleRef,
    ): Promise<BaseCheckpointSaver> => {
      const cfg: CheckpointerOptions = options?.checkpointer ?? {
        type: "memory",
      };
      if ("useExisting" in cfg) {
        return moduleRef.get(cfg.useExisting, { strict: false });
      }
      if ("useFactory" in cfg) {
        const deps = (cfg.inject ?? []).map((t) =>
          moduleRef.get(t, { strict: false }),
        );
        return cfg.useFactory(...deps);
      }
      return new MemorySaver();
    },
    inject: [LANGGRAPH_MODULE_OPTIONS, ModuleRef],
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
        checkpointerProvider(),
        GraphRegistry,
      ],
      exports: [LANGGRAPH_CHECKPOINTER, GraphRegistry],
    };
  }

  /**
   * Registers graph definition classes as providers and creates one injectable
   * facade provider per graph (retrievable via `@InjectLangGraphRunnable`).
   */
  static forFeature(graphDefs: Type<any>[]): DynamicModule {
    const providers: Provider[] = [];
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
