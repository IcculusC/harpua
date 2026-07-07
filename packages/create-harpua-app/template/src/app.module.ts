import { Module } from "@nestjs/common";
import { LangGraphModule } from "@harpua/langgraph";

import { AgentModule } from "./agent/agent.module";

@Module({
  imports: [
    LangGraphModule.forRoot({ checkpointer: { type: "memory" } }),
    AgentModule,
  ],
})
export class AppModule {}
