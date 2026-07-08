import type { Type } from "@nestjs/common";
import { HumanMessage, isAIMessage } from "@langchain/core/messages";
import {
  createGraphTestingModule,
  ruleModel,
  expectInterrupt,
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
 * The approval gate, end to end: a scripted model emits the side-effectful
 * send_weather_report tool, the framework pauses with a tool_approval_request
 * interrupt, and only an approved resume runs the tool (records into the
 * OutboxService). A decline leaves the outbox empty. Fully offline: a fake fetch
 * feeds canned Open-Meteo JSON.
 * --------------------------------------------------------------------- */
describe("send_weather_report approval gate (integration)", () => {
  let harness: GraphTestingHarness;

  const fakeFetch: FetchFn = async (url: string) => {
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

  /** Mirrors MockChatModel: a send intent -> send_weather_report; summarize results. */
  function reportModel(): Type<FakeChatModel> {
    return ruleModel()
      .onToolResult((last) => textOf(last))
      .onHuman(
        /\b(?:send|e-?mail|report)\b[\s\S]*?\bfor\s+([a-z][a-z .'-]*?)\s+to\s+(\S+)/i,
        (_text, match) => ({
          toolCalls: [
            {
              name: "send_weather_report",
              args: {
                location: (match[1] ?? "").trim(),
                recipient: (match[2] ?? "").trim(),
              },
            },
          ],
        }),
      )
      .fallback("Ask me to send a weather report.")
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

  afterEach(async () => {
    await harness?.close();
  });

  const send = "send a weather report for Berlin to alice@example.com";

  it("pauses for approval, then sends on approval and records the outbox", async () => {
    harness = await boot(reportModel());
    const agent = harness.get<AgentState>(WeatherAgentGraph);
    const outbox = harness.app.get(OutboxService);
    const cfg = { configurable: { thread_id: "send-approve" } };

    const paused = await agent.invoke(
      { messages: [new HumanMessage(send)] },
      cfg,
    );
    const pending = expectInterrupt<{
      type: string;
      tool: string;
      args: { location: string; recipient: string };
    }>(paused);
    expect(pending).toEqual(
      expect.objectContaining({
        type: "tool_approval_request",
        tool: "send_weather_report",
        args: { location: "Berlin", recipient: "alice@example.com" },
      }),
    );
    // Nothing sent while the gate is pending.
    expect(outbox.sent).toHaveLength(0);

    const resumed = await agent.resume("send-approve", { approved: true });
    // The tool ran: outbox recorded, and the confirmation text is visible.
    expect(outbox.sent).toEqual([
      {
        recipient: "alice@example.com",
        body: expect.stringContaining("21.3°C"),
      },
    ]);
    expect(aiText(resumed)).toContain(
      "Sent a weather report for Berlin to alice@example.com",
    );
  });

  it("declines on a non-approval resume: outbox empty, decline text visible", async () => {
    harness = await boot(reportModel());
    const agent = harness.get<AgentState>(WeatherAgentGraph);
    const outbox = harness.app.get(OutboxService);
    const cfg = { configurable: { thread_id: "send-decline" } };

    const paused = await agent.invoke(
      { messages: [new HumanMessage(send)] },
      cfg,
    );
    expect(expectInterrupt(paused)).toBeDefined();

    const resumed = await agent.resume("send-decline", { approved: false });
    // The tool never ran.
    expect(outbox.sent).toHaveLength(0);
    expect(aiText(resumed)).toContain("declined send_weather_report");
  });
});
