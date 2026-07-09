import { Injectable } from "@nestjs/common";
import { z } from "zod";
import { StateSchema, MessagesValue } from "@langchain/langgraph";
import { AIMessage, ToolMessage, isAIMessage } from "@langchain/core/messages";

import {
  LangGraph,
  LangGraphTool,
  NodeHandler,
  START,
  END,
  TOOLS,
  defineEdges,
  route,
  as,
  interrupt,
  type StateOf,
} from "../index";

/* ------------------------------------------------------------------ */
/* Linear graph + DI                                                   */
/* ------------------------------------------------------------------ */

export const CounterState = z.object({
  steps: z.array(z.string()),
  total: z.number(),
});
export type CounterStateT = z.infer<typeof CounterState>;

@Injectable()
export class IncrementService {
  by(n: number): number {
    return n + 1;
  }
}

@Injectable()
export class NodeA implements NodeHandler<{ steps: string[]; total: number }> {
  constructor(private readonly inc: IncrementService) {}
  run(state: { steps: string[]; total: number }) {
    return { steps: [...state.steps, "A"], total: this.inc.by(state.total) };
  }
}

@Injectable()
export class NodeB implements NodeHandler<{ steps: string[]; total: number }> {
  constructor(private readonly inc: IncrementService) {}
  run(state: { steps: string[]; total: number }) {
    return { steps: [...state.steps, "B"], total: this.inc.by(state.total) };
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
/* Node reuse across two graphs with different composite states        */
/* ------------------------------------------------------------------ */

// Narrow slice: only touches `log`.
@Injectable()
export class LogStamp implements NodeHandler<{ log: string[] }> {
  run(state: { log: string[] }) {
    return { log: [...state.log, "stamp"] };
  }
}

export const GraphOneState = z.object({
  log: z.array(z.string()),
  alpha: z.string(),
});
export type GraphOneStateT = z.infer<typeof GraphOneState>;

export const GraphTwoState = z.object({
  log: z.array(z.string()),
  beta: z.number(),
});
export type GraphTwoStateT = z.infer<typeof GraphTwoState>;

@Injectable()
export class SetAlpha implements NodeHandler<{ alpha: string }> {
  run() {
    return { alpha: "set" };
  }
}

@Injectable()
export class SetBeta implements NodeHandler<{ beta: number }> {
  run() {
    return { beta: 99 };
  }
}

@LangGraph({ name: "reuseOne", state: GraphOneState })
export class ReuseGraphOne {
  edges = defineEdges<GraphOneStateT>([
    { from: START, to: LogStamp },
    { from: LogStamp, to: SetAlpha },
    { from: SetAlpha, to: END },
  ]);
}

@LangGraph({ name: "reuseTwo", state: GraphTwoState })
export class ReuseGraphTwo {
  edges = defineEdges<GraphTwoStateT>([
    { from: START, to: LogStamp },
    { from: LogStamp, to: SetBeta },
    { from: SetBeta, to: END },
  ]);
}

/* ------------------------------------------------------------------ */
/* Agentic loop with tools                                             */
/* ------------------------------------------------------------------ */

export const AgentMessagesState = new StateSchema({ messages: MessagesValue });
export type MsgState = StateOf<typeof AgentMessagesState>;

@Injectable()
export class OrderService {
  public calls: string[] = [];
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

@Injectable()
export class CallModel implements NodeHandler<MsgState> {
  run(state: MsgState) {
    const last = state.messages[state.messages.length - 1];
    if (last instanceof ToolMessage) {
      // Tool result already present -> finish.
      return { messages: [new AIMessage("Your order is shipped.")] };
    }
    // First pass: request the tool.
    return {
      messages: [
        new AIMessage({
          content: "",
          tool_calls: [
            {
              name: "lookup_order",
              args: { id: "42" },
              id: "call_1",
              type: "tool_call",
            },
          ],
        }),
      ],
    };
  }
}

export function hasToolCalls(state: MsgState): typeof TOOLS | typeof END {
  const last = state.messages[state.messages.length - 1];
  return last && isAIMessage(last) && (last.tool_calls?.length ?? 0) > 0
    ? TOOLS
    : END;
}

@LangGraph({ name: "agent", state: AgentMessagesState, tools: [OrderTools] })
export class AgentGraph {
  edges = defineEdges<MsgState>([
    { from: START, to: CallModel },
    { from: CallModel, to: route<MsgState>(hasToolCalls, [TOOLS, END]) },
    { from: TOOLS, to: CallModel },
  ]);
}

// A model that never stops requesting tools -> used to exercise recursionLimit.
@Injectable()
export class AlwaysToolModel implements NodeHandler<MsgState> {
  run() {
    return {
      messages: [
        new AIMessage({
          content: "",
          tool_calls: [
            {
              name: "lookup_order",
              args: { id: "1" },
              id: "loop",
              type: "tool_call",
            },
          ],
        }),
      ],
    };
  }
}

@LangGraph({
  name: "loop",
  state: AgentMessagesState,
  tools: [OrderTools],
  recursionLimit: 3,
})
export class LoopGraph {
  edges = defineEdges<MsgState>([
    { from: START, to: AlwaysToolModel },
    { from: AlwaysToolModel, to: route<MsgState>(() => TOOLS, [TOOLS]) },
    { from: TOOLS, to: AlwaysToolModel },
  ]);
}

/* ------------------------------------------------------------------ */
/* Subgraphs                                                           */
/* ------------------------------------------------------------------ */

export const TrailState = z.object({ trail: z.array(z.string()) });
export type TrailStateT = z.infer<typeof TrailState>;

@Injectable()
export class StepOne implements NodeHandler<TrailStateT> {
  run(s: TrailStateT) {
    return { trail: [...s.trail, "one"] };
  }
}

@Injectable()
export class StepTwo implements NodeHandler<TrailStateT> {
  run(s: TrailStateT) {
    return { trail: [...s.trail, "two"] };
  }
}

@LangGraph({ name: "childOne", state: TrailState })
export class ChildOne {
  edges = defineEdges<TrailStateT>([
    { from: START, to: StepOne },
    { from: StepOne, to: END },
  ]);
}

@LangGraph({ name: "childTwo", state: TrailState })
export class ChildTwo {
  edges = defineEdges<TrailStateT>([
    { from: START, to: StepTwo },
    { from: StepTwo, to: END },
  ]);
}

@LangGraph({ name: "parent", state: TrailState })
export class ParentGraph {
  edges = defineEdges<TrailStateT>([
    { from: START, to: ChildOne },
    { from: ChildOne, to: ChildTwo },
    { from: ChildTwo, to: END },
  ]);
}

/* ------------------------------------------------------------------ */
/* Alias                                                               */
/* ------------------------------------------------------------------ */

@Injectable()
export class Appender implements NodeHandler<TrailStateT> {
  run(s: TrailStateT) {
    return { trail: [...s.trail, "*"] };
  }
}

@LangGraph({ name: "aliased", state: TrailState })
export class AliasedGraph {
  edges = defineEdges<TrailStateT>([
    { from: START, to: as("first", Appender) },
    { from: as("first", Appender), to: as("second", Appender) },
    { from: as("second", Appender), to: END },
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
