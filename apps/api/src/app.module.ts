import { Module } from "@nestjs/common";
import { LangGraphModule } from "@harpua/langgraph";
import { AppController } from "./app.controller";
import { AppService } from "./app.service";
import { ChatModule } from "./chat/chat.module";

@Module({
  imports: [
    LangGraphModule.forRoot({ checkpointer: { type: "memory" } }),
    ChatModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
