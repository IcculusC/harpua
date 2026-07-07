import { Module } from "@nestjs/common";
import { LangGraphModule } from "@harpua/langgraph";

import { AgentController } from "./agent.controller";
import { AgentService } from "./agent.service";
import { CallModelNode, WeatherAgentGraph } from "./weather-agent.graph";
import { WeatherTools } from "./weather.tools";
import { chatModelProvider } from "./chat-model.provider";
import { fetchProvider } from "./fetch.token";

@Module({
  imports: [LangGraphModule.forFeature([WeatherAgentGraph])],
  controllers: [AgentController],
  providers: [
    WeatherTools,
    CallModelNode,
    AgentService,
    chatModelProvider,
    fetchProvider,
  ],
  exports: [AgentService],
})
export class AgentModule {}
