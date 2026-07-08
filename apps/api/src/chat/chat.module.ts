import { Module } from "@nestjs/common";
import { LangGraphModule, provideGraphBoundModel } from "@harpua/langgraph";
import { CHAT_MODEL, ChatModelModule } from "@harpua/models";

import { ChatController } from "./chat.controller";
import { ChatService } from "./chat.service";
import { CallModelNode, ChatGraph } from "./chat.graph";
import { CHAT_BOUND_MODEL } from "./chat-model.token";
import { MockChatModel } from "./mock-chat-model";
import { OrderTools } from "./order.tools";
import { OrdersService } from "./orders.service";
import { SystemPrompt } from './system-prompt';

@Module({
  imports: [
    LangGraphModule.forFeature([ChatGraph]),
    // Default chat model, env-driven. This demo stays mock-by-default: the
    // order-aware MockChatModel is supplied as the mock arm's factory, so the
    // whole demo runs offline unless MODEL_PROVIDER is flipped to a real arm.
    ChatModelModule.forRoot({
      defaults: { mockModel: () => new MockChatModel() },
    }),
    // Named roles as living examples of the one-key-many-models pattern. Each
    // preset is ARM-SCOPED (defaults.openrouter.model), so with no env every
    // role boots on the mock arm — keyless boot stays intact. Flip one real
    // with a single var, e.g. FAST_MODEL_PROVIDER=openrouter (+ the shared
    // OPENROUTER_API_KEY); the model id is already preset. Inject with
    // @InjectChatModel("fast" | "smart" | "tools").
    ChatModelModule.register({
      name: "fast",
      defaults: { openrouter: { model: "deepseek/deepseek-v4-flash" } },
    }),
    ChatModelModule.register({
      name: "smart",
      defaults: { openrouter: { model: "deepseek/deepseek-v4-pro" } },
    }),
    ChatModelModule.register({
      name: "tools",
      defaults: { openrouter: { model: "openai/gpt-oss-120b" } },
    }),
  ],
  controllers: [ChatController],
  providers: [
    OrdersService,
    OrderTools,
    // Bind ChatGraph's tools to the chat model so a real model can emit the
    // lookup_order tool call (the ToolNode only executes them). Mock-by-default
    // is unchanged: MockChatModel.bindTools is a no-op returning itself.
    provideGraphBoundModel({
      provide: CHAT_BOUND_MODEL,
      graph: ChatGraph,
      model: CHAT_MODEL,
    }),
    CallModelNode,
    ChatService,
    SystemPrompt,
  ],
  exports: [ChatService],
})
export class ChatModule {}
