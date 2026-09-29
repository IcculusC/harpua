import { Module } from "@nestjs/common";
import { LangGraphModule } from "@harpua/langgraph";
import { AppController } from "./app.controller.js";
import { AppService } from "./app.service.js";
import { ChatModule } from "./chat/chat.module.js";

@Module({
  imports: [
    LangGraphModule.forRoot({ checkpointer: { type: "memory" } }),
    ChatModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
