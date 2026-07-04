import { Injectable } from "@nestjs/common";
import { MessagesAnnotation } from "@langchain/langgraph";
import {
  AIMessage,
  isAIMessage,
  type BaseMessage,
} from "@langchain/core/messages";
import {
  LangGraph,
  NodeHandler,
  START,
  END,
  TOOLS,
  defineEdges,
  route,
  interrupt,
} from "@harpua/langgraph";

import { MockChatModel, type PendingAction } from "./mock-chat-model";
import { OrderTools } from "./order.tools";
import { OrdersService } from "./orders.service";

export type ChatState = { messages: BaseMessage[] };

@Injectable()
export class CallModelNode implements NodeHandler<ChatState> {
  constructor(private readonly model: MockChatModel) {}

  run(state: ChatState) {
    return { messages: [this.model.respond(state.messages)] };
  }
}

/**
 * Pauses the graph with an interrupt describing the pending action. On resume
 * the node re-runs: `interrupt()` returns the resume value, and the action is
 * executed or declined accordingly.
 */
@Injectable()
export class ApprovalNode implements NodeHandler<ChatState> {
  constructor(private readonly orders: OrdersService) {}

  run(state: ChatState) {
    const last = state.messages[state.messages.length - 1];
    const pending = (last as AIMessage).additional_kwargs
      ?.pending_action as PendingAction;

    const decision = interrupt({
      type: "approval_request",
      action: pending.action,
      orderId: pending.orderId,
      message: pending.orderId
        ? `Approve cancellation of order ${pending.orderId}?`
        : `Approve this action: "${pending.request}"?`,
    }) as boolean | { approved?: boolean };

    const approved =
      typeof decision === "boolean" ? decision : decision?.approved === true;

    if (!approved) {
      return {
        messages: [
          new AIMessage("Understood — I have not made any changes."),
        ],
      };
    }

    const outcome = pending.orderId
      ? this.orders.cancel(pending.orderId)
      : "Done.";
    return { messages: [new AIMessage(outcome)] };
  }
}

function routeAfterModel(
  state: ChatState,
): typeof TOOLS | typeof ApprovalNode | typeof END {
  const last = state.messages[state.messages.length - 1];
  if (last && isAIMessage(last)) {
    if ((last.tool_calls?.length ?? 0) > 0) return TOOLS;
    if (last.additional_kwargs?.pending_action) return ApprovalNode;
  }
  return END;
}

@LangGraph({
  name: "chat",
  state: MessagesAnnotation,
  tools: [OrderTools],
  recursionLimit: 10,
})
export class ChatGraph {
  edges = defineEdges<ChatState>([
    { from: START, to: CallModelNode },
    {
      from: CallModelNode,
      to: route<ChatState>(routeAfterModel, [TOOLS, ApprovalNode, END]),
    },
    { from: TOOLS, to: CallModelNode },
    { from: ApprovalNode, to: END },
  ]);
}
