import { Module } from "@nestjs/common";
import { LangGraphModule } from "@harpua/langgraph";
import { ChatModelModule } from "@harpua/models";

import { ChatController } from "./chat.controller";
import { ChatService } from "./chat.service";
import { ApprovalNode, CallModelNode, ChatGraph } from "./chat.graph";
import { MockChatModel } from "./mock-chat-model";
import { OrderTools } from "./order.tools";
import { OrdersService } from "./orders.service";

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
    CallModelNode,
    ApprovalNode,
    ChatService,
  ],
  exports: [ChatService],
})
export class ChatModule {}
