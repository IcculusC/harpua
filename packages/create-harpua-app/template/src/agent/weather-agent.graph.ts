import { Inject, Injectable } from "@nestjs/common";
import { StateSchema, MessagesValue } from "@langchain/langgraph";
import { isAIMessage } from "@langchain/core/messages";
import { thinkTool } from "@harpua/agent-tools";
import {
  LangGraph,
  NodeHandler,
  START,
  END,
  TOOLS,
  defineEdges,
  route,
  type StateOf,
} from "@harpua/langgraph";

import { CHAT_MODEL, type ChatModel } from "./chat-model.provider";
import { WeatherTools } from "./weather.tools";

/** Zod-first agent state: just the running message list. */
export const AgentStateSchema = new StateSchema({ messages: MessagesValue });
export type AgentState = StateOf<typeof AgentStateSchema>;

/** Calls the chat model and appends its reply. */
@Injectable()
export class CallModelNode implements NodeHandler<AgentState> {
  constructor(@Inject(CHAT_MODEL) private readonly model: ChatModel) {}

  async run(state: AgentState) {
    return { messages: [await this.model.invoke(state.messages)] };
  }
}

/** Loop back to the tools node while the model is still requesting tools. */
export function shouldContinue(state: AgentState): typeof TOOLS | typeof END {
  const last = state.messages[state.messages.length - 1];
  return last && isAIMessage(last) && (last.tool_calls?.length ?? 0) > 0
    ? TOOLS
    : END;
}

/**
 * The ReAct-style weather agent. `WeatherTools` (a DI provider class) and
 * `thinkTool()` (a raw LangChain tool instance) are mounted together in the same
 * tools node — mixed provider-class + raw-instance mounting.
 */
@LangGraph({
  name: "weatherAgent",
  state: AgentStateSchema,
  tools: [WeatherTools, thinkTool()],
  recursionLimit: 10,
})
export class WeatherAgentGraph {
  edges = defineEdges<AgentState>([
    { from: START, to: CallModelNode },
    { from: CallModelNode, to: route<AgentState>(shouldContinue, [TOOLS, END]) },
    { from: TOOLS, to: CallModelNode },
  ]);
}
