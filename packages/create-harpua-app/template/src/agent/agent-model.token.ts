/**
 * DI token for the weather agent's tool-bound chat model.
 * `provideGraphBoundModel` (in agent.module.ts) publishes
 * `CHAT_MODEL.bindTools(WeatherAgentGraph's tools)` under this token so a real
 * model can actually emit the `get_weather` / `think` tool calls the graph's
 * ToolNode executes. `CallModelNode` injects it.
 */
export const AGENT_BOUND_MODEL = Symbol.for("harpua:AGENT_BOUND_MODEL");
