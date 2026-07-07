import { Global, Module, type DynamicModule } from "@nestjs/common";

import {
  CHAT_MODEL,
  CHAT_MODEL_MODULE_OPTIONS,
  getChatModelToken,
} from "./constants";
import {
  ForRootOptionsSchema,
  RegisterOptionsSchema,
  type ForRootOptions,
  type RegisterOptions,
  type Registration,
} from "./interfaces";
import { buildChatModel } from "./model-factory";
import { envPrefixOf, registerName, registerRoot } from "./registry";

/**
 * Provides chat models to a NestJS app by named registration, env-driven, with
 * every LangChain integration an optional peer.
 *
 * - {@link ChatModelModule.forRoot} registers the DEFAULT model (token
 *   {@link CHAT_MODEL}), reading un-prefixed env (`MODEL_PROVIDER`, …). Call it
 *   once, before any `register()`.
 * - {@link ChatModelModule.register} adds a named model reading a
 *   SCREAMING_SNAKE-prefixed env (`FAST_MODEL_PROVIDER`, …), injected with
 *   `@InjectChatModel("fast")`.
 *
 * The module is `@Global`, so registered models are injectable app-wide without
 * re-importing.
 */
@Global()
@Module({})
export class ChatModelModule {
  static forRoot(options: ForRootOptions = {}): DynamicModule {
    const opts = ForRootOptionsSchema.parse(options);
    registerRoot();

    const reg: Registration = {
      name: "default",
      envPrefix: "",
      defaults: opts.defaults,
    };

    return {
      module: ChatModelModule,
      providers: [
        { provide: CHAT_MODEL_MODULE_OPTIONS, useValue: opts },
        { provide: CHAT_MODEL, useFactory: () => buildChatModel(reg) },
      ],
      // CHAT_MODEL_MODULE_OPTIONS is exported (and the module is @Global) so that
      // each register()ed provider can inject it — the DI edge that makes a
      // register() without a prior forRoot() fail Nest bootstrap.
      exports: [CHAT_MODEL, CHAT_MODEL_MODULE_OPTIONS],
    };
  }

  static register(options: RegisterOptions): DynamicModule {
    const opts = RegisterOptionsSchema.parse(options);
    const name = registerName(opts.name);

    const reg: Registration = {
      name,
      envPrefix: envPrefixOf(name),
      defaults: opts.defaults,
    };
    const token = getChatModelToken(name);

    return {
      module: ChatModelModule,
      providers: [
        {
          provide: token,
          // Injecting the forRoot-only options token enforces the ordering
          // invariant through the DI graph: registering without forRoot() fails
          // to resolve this dependency at bootstrap. The value itself is unused.
          useFactory: (_options: ForRootOptions) => buildChatModel(reg),
          inject: [CHAT_MODEL_MODULE_OPTIONS],
        },
      ],
      exports: [token],
    };
  }
}
