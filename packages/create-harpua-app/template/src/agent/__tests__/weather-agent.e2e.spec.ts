import type { Type } from "@nestjs/common";
import { HumanMessage, isAIMessage } from "@langchain/core/messages";
import {
  createGraphTestingModule,
  ruleModel,
  scriptedModel,
  collectStream,
  textOf,
  type GraphTestingHarness,
  type FakeChatModel,
} from "@harpua/langgraph-testing";

import {
  CallModelNode,
  WeatherAgentGraph,
  type AgentState,
} from "../weather-agent.graph";
import { WeatherTools } from "../weather.tools";
import { OutboxService } from "../outbox.service";
import { CHAT_MODEL } from "@harpua/models";
import { provideGraphBoundModel } from "@harpua/langgraph";
import { AGENT_BOUND_MODEL } from "../agent-model.token";
import { WEATHER_FETCH, type FetchFn } from "../fetch.token";

/* --------------------------------------------------------------------- *
 * Graph-level integration, fully offline: a fake fetch feeds canned
 * Open-Meteo JSON, and the runtime MockChatModel is swapped (in tests only)
 * for a helper model driving the same get_weather loop.
 * --------------------------------------------------------------------- */
describe("Weather agent (integration)", () => {
  let harness: GraphTestingHarness;
  const fetchCalls: string[] = [];

  /** Canned Open-Meteo responses; records every URL for a DI assertion. */
  const fakeFetch: FetchFn = async (url: string) => {
    fetchCalls.push(url);
    const body = url.includes("geocoding")
      ? {
          results: [
            {
              name: "Berlin",
              latitude: 52.52,
              longitude: 13.41,
              country: "Germany",
            },
          ],
        }
      : {
          current: { temperature_2m: 21.3, weather_code: 0, wind_speed_10m: 5 },
          current_units: { temperature_2m: "°C" },
        };
    return { json: async () => body };
  };

  /** A rule model mirroring MockChatModel: weather request -> tool, then summarize. */
  function weatherModel(): Type<FakeChatModel> {
    return ruleModel()
      .onToolResult((last) => textOf(last))
      .onHuman(/weather\b[\s\S]*?\bin\s+([a-z][a-z .'-]*)/i, (_text, match) => ({
        toolCalls: [
          { name: "get_weather", args: { location: (match[1] ?? "").trim() } },
        ],
      }))
      .fallback("Ask me about the weather in a place.")
      .build();
  }

  function boot(model: Type<FakeChatModel>): Promise<GraphTestingHarness> {
    return createGraphTestingModule({
      graphs: [WeatherAgentGraph],
      providers: [
        WeatherTools,
        OutboxService,
        CallModelNode,
        { provide: CHAT_MODEL, useClass: model },
        provideGraphBoundModel({
          provide: AGENT_BOUND_MODEL,
          graph: WeatherAgentGraph,
          model: CHAT_MODEL,
        }),
        { provide: WEATHER_FETCH, useValue: fakeFetch },
      ],
    });
  }

  function aiText(state: AgentState): string {
    return state.messages
      .filter((m) => isAIMessage(m))
      .map((m) => textOf(m))
      .filter((t) => t.length > 0)
      .join("\n");
  }

  beforeEach(() => {
    fetchCalls.length = 0;
  });

  afterEach(async () => {
    await harness?.close();
  });

  it("answers a non-weather turn with help text and no tool call", async () => {
    harness = await boot(weatherModel());
    const agent = harness.get<AgentState>(WeatherAgentGraph);

    const result = await agent.invoke({
      messages: [new HumanMessage("hello there")],
    });

    expect(aiText(result)).toContain("Ask me about the weather");
    expect(fetchCalls).toHaveLength(0);
  });

  it("runs get_weather through DI and summarizes the canned forecast", async () => {
    harness = await boot(weatherModel());
    const agent = harness.get<AgentState>(WeatherAgentGraph);

    const result = await agent.invoke({
      messages: [new HumanMessage("what's the weather in Berlin?")],
    });

    // Final assistant text is the summarized tool result.
    expect(aiText(result)).toContain("21.3°C");
    expect(aiText(result)).toContain("Berlin, Germany");
    // DI proof: the tool reached the injected fake fetch, both endpoints.
    expect(fetchCalls.some((u) => u.includes("geocoding"))).toBe(true);
    expect(fetchCalls.some((u) => u.includes("/v1/forecast"))).toBe(true);
  });

  it("surfaces a 'tools' node update while looping", async () => {
    harness = await boot(weatherModel());
    const agent = harness.get<AgentState>(WeatherAgentGraph);

    const chunks = await collectStream(
      await agent.streamUpdates({
        messages: [new HumanMessage("weather in Berlin")],
      }),
    );

    const nodes = chunks.map((c) => Object.keys(c)[0]);
    expect(nodes).toContain("CallModelNode");
    expect(nodes).toContain("tools");
  });

  it("drives the same loop from a scripted sequence, zero rules", async () => {
    const scripted = scriptedModel()
      .toolCall("get_weather", { location: "Berlin" })
      .say("There you go.")
      .build();
    harness = await boot(scripted);
    const agent = harness.get<AgentState>(WeatherAgentGraph);

    const result = await agent.invoke({
      messages: [new HumanMessage("tell me")],
    });

    expect(fetchCalls.some((u) => u.includes("geocoding"))).toBe(true);
    expect(aiText(result)).toContain("There you go.");
  });
});
