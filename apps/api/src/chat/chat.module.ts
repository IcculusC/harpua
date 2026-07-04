import { Module } from "@nestjs/common";
import { LangGraphModule } from "@harpua/langgraph";

import { ChatController } from "./chat.controller";
import { ChatService } from "./chat.service";
import { ApprovalNode, CallModelNode, ChatGraph } from "./chat.graph";
import { MockChatModel } from "./mock-chat-model";
import { OrderTools } from "./order.tools";
import { OrdersService } from "./orders.service";

@Module({
  imports: [LangGraphModule.forFeature([ChatGraph])],
  controllers: [ChatController],
  providers: [
    OrdersService,
    OrderTools,
    MockChatModel,
    CallModelNode,
    ApprovalNode,
    ChatService,
  ],
  exports: [ChatService],
})
export class ChatModule {}
