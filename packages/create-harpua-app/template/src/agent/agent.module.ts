import { Module } from "@nestjs/common";
import { LangGraphModule } from "@harpua/langgraph";
import { ChatModelModule } from "@harpua/models";

import { AgentController } from "./agent.controller";
import { AgentService } from "./agent.service";
import { CallModelNode, WeatherAgentGraph } from "./weather-agent.graph";
import { WeatherTools } from "./weather.tools";
import { MockChatModel } from "./mock-chat-model";
import { fetchProvider } from "./fetch.token";

@Module({
  imports: [
    LangGraphModule.forFeature([WeatherAgentGraph]),
    // Env-driven chat model. Mock by default (offline, deterministic) via the
    // in-project weather MockChatModel; flip MODEL_PROVIDER=openrouter (+ key +
    // model) to run a real model. See the README "Choosing a model" table.
    ChatModelModule.forRoot({
      defaults: { mockModel: () => new MockChatModel() },
    }),
    // Named roles: living examples of the one-key-many-models pattern. Presets
    // are ARM-SCOPED (defaults.openrouter.model), so with no env each role boots
    // on the mock arm — keyless boot stays intact. Flip one real with a single
    // var, e.g. FAST_MODEL_PROVIDER=openrouter (+ the shared OPENROUTER_API_KEY);
    // inject with @InjectChatModel("fast" | "smart" | "tools").
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
  controllers: [AgentController],
  providers: [WeatherTools, CallModelNode, AgentService, fetchProvider],
  exports: [AgentService],
})
export class AgentModule {}
