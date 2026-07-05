import { Inject, Injectable } from "@nestjs/common";
import { z } from "zod";
import { StateSchema, MessagesValue } from "@langchain/langgraph";
import { isAIMessage } from "@langchain/core/messages";
import {
  LangGraph,
  LangGraphTool,
  NodeHandler,
  START,
  END,
  TOOLS,
  defineEdges,
  route,
  interrupt,
  type StateOf,
} from "@harpua/langgraph";

import { CLOCK, type Clock } from "../clock";
import type { ScriptedChatModel } from "../scripted-model";

/* ------------------------------------------------------------------ */
/* Linear graph (streaming / module fixtures)                          */
/* ------------------------------------------------------------------ */

export const CounterState = z.object({
  steps: z.array(z.string()),
  total: z.number(),
});
export type CounterStateT = z.infer<typeof CounterState>;

@Injectable()
export class NodeA implements NodeHandler<CounterStateT> {
  run(state: CounterStateT) {
    return { steps: [...state.steps, "A"], total: state.total + 1 };
  }
}

@Injectable()
export class NodeB implements NodeHandler<CounterStateT> {
  run(state: CounterStateT) {
    return { steps: [...state.steps, "B"], total: state.total + 1 };
  }
}

@LangGraph({ name: "linear", state: CounterState })
export class LinearGraph {
  edges = defineEdges<CounterStateT>([
    { from: START, to: NodeA },
    { from: NodeA, to: NodeB },
    { from: NodeB, to: END },
  ]);
}

/* ------------------------------------------------------------------ */
/* Agentic loop with a DI-injected model + real tool                   */
/* ------------------------------------------------------------------ */

export const AgentState = new StateSchema({ messages: MessagesValue });
export type AgentStateT = StateOf<typeof AgentState>;

/** DI token the scripted/rule model is bound to for the agent fixture. */
export const CHAT_MODEL = Symbol.for("@harpua/langgraph-testing/test:CHAT_MODEL");

@Injectable()
export class OrderService {
  readonly calls: string[] = [];
  lookup(id: string): string {
    this.calls.push(id);
    return `Order ${id}: shipped`;
  }
}

@Injectable()
export class OrderTools {
  constructor(private readonly svc: OrderService) {}

  @LangGraphTool({
    name: "lookup_order",
    description: "Look up the status of an order by id",
    schema: z.object({ id: z.string() }),
  })
  lookupOrder(input: { id: string }): string {
    return this.svc.lookup(input.id);
  }
}

/** A CallModel-style node that consumes whatever model is bound to CHAT_MODEL. */
@Injectable()
export class CallModel implements NodeHandler<AgentStateT> {
  constructor(
    @Inject(CHAT_MODEL) private readonly model: ScriptedChatModel,
  ) {}

  run(state: AgentStateT) {
    return { messages: [this.model.respond(state.messages)] };
  }
}

function afterModel(state: AgentStateT): typeof TOOLS | typeof END {
  const last = state.messages[state.messages.length - 1];
  return last && isAIMessage(last) && (last.tool_calls?.length ?? 0) > 0
    ? TOOLS
    : END;
}

@LangGraph({
  name: "agent",
  state: AgentState,
  tools: [OrderTools],
  recursionLimit: 10,
})
export class AgentGraph {
  edges = defineEdges<AgentStateT>([
    { from: START, to: CallModel },
    { from: CallModel, to: route<AgentStateT>(afterModel, [TOOLS, END]) },
    { from: TOOLS, to: CallModel },
  ]);
}

/* ------------------------------------------------------------------ */
/* Interrupt / resume                                                  */
/* ------------------------------------------------------------------ */

export const HilState = z.object({
  question: z.string(),
  answer: z.string(),
});
export type HilStateT = z.infer<typeof HilState>;

@Injectable()
export class AskHumanNode implements NodeHandler<HilStateT> {
  run(state: HilStateT) {
    const provided = interrupt(state.question);
    return { answer: String(provided) };
  }
}

@LangGraph({ name: "hil", state: HilState })
export class HilGraph {
  edges = defineEdges<HilStateT>([
    { from: START, to: AskHumanNode },
    { from: AskHumanNode, to: END },
  ]);
}

/* ------------------------------------------------------------------ */
/* Clock-consuming graph (determinism fixture)                         */
/* ------------------------------------------------------------------ */

export const StampState = z.object({ stamps: z.array(z.string()) });
export type StampStateT = z.infer<typeof StampState>;

@Injectable()
export class StampNode implements NodeHandler<StampStateT> {
  constructor(@Inject(CLOCK) private readonly clock: Clock) {}

  run(state: StampStateT) {
    return { stamps: [...state.stamps, this.clock.now().toISOString()] };
  }
}

@LangGraph({ name: "stamp", state: StampState })
export class StampGraph {
  edges = defineEdges<StampStateT>([
    { from: START, to: StampNode },
    { from: StampNode, to: END },
  ]);
}
