import { Inject, Injectable } from "@nestjs/common";
import { StateSchema, MessagesValue } from "@langchain/langgraph";
import { isAIMessage } from "@langchain/core/messages";
import {
  LangGraph,
  NodeHandler,
  START,
  END,
  TOOLS,
  defineEdges,
  route,
  type StateOf,
  type GraphBoundModel,
} from "@harpua/langgraph";

import { CHAT_BOUND_MODEL } from "./chat-model.token";
import { SystemPrompt } from "./system-prompt";
import { OrderTools } from "./order.tools";

export const ChatMessagesState = new StateSchema({ messages: MessagesValue });
export type ChatState = StateOf<typeof ChatMessagesState>;

@Injectable()
export class CallModelNode implements NodeHandler<ChatState> {
  constructor(
    @Inject(CHAT_BOUND_MODEL) private readonly model: GraphBoundModel,
    private readonly systemPrompt: SystemPrompt,
  ) {}

  async run(state: ChatState) {
    const messages = [this.systemPrompt.asMessage(), ...state.messages];
    return { messages: [await this.model.invoke(messages)] };
  }
}

/**
 * Route on the model's output: any tool call (including the approval-gated
 * `cancel_order`) goes to the ToolNode; the approval pause now happens INSIDE
 * that tool via the framework's tool gate, so there is no separate approval
 * node or side-channel to branch on.
 */
function routeAfterModel(state: ChatState): typeof TOOLS | typeof END {
  const last = state.messages[state.messages.length - 1];
  if (last && isAIMessage(last) && (last.tool_calls?.length ?? 0) > 0) {
    return TOOLS;
  }
  return END;
}

@LangGraph({
  name: "chat",
  state: ChatMessagesState,
  tools: [OrderTools],
  recursionLimit: 10,
})
export class ChatGraph {
  edges = defineEdges<ChatState>([
    { from: START, to: CallModelNode },
    {
      from: CallModelNode,
      to: route<ChatState>(routeAfterModel, [TOOLS, END]),
    },
    { from: TOOLS, to: CallModelNode },
  ]);
}
