import { Test } from "@nestjs/testing";
import { Injectable, type INestApplication } from "@nestjs/common";
import { ModuleRef } from "@nestjs/core";
import { StateSchema, MessagesValue } from "@langchain/langgraph";
import {
  AIMessage,
  HumanMessage,
  ToolMessage,
  isAIMessage,
  type BaseMessage,
} from "@langchain/core/messages";
import {
  BaseChatModel,
  type BindToolsInput,
} from "@langchain/core/language_models/chat_models";
import type { ChatResult } from "@langchain/core/outputs";

import {
  LangGraph,
  LangGraphAgent,
  LangGraphModule,
  LangGraphRunnableConfig,
  START,
  END,
  TOOLS,
  defineEdges,
  route,
  getGraphFacadeToken,
  provideGraphBoundModel,
  type GraphBoundModel,
  type NodeHandler,
} from "../index";
import { OrderService, OrderTools, hasToolCalls, type MsgState } from "./fixtures";

/**
 * Proves "the preset IS the lowered graph" on the messages contract: a
 * hand-written `@LangGraph` eject of the model<->tools loop and the
 * equivalent `@LangGraphAgent` preset, driven by identical scripted models
 * and the same input, must produce the same observable message flow (same
 * kinds in order, same tool call emitted, a ToolMessage present, same final
 * AI text). Loop/exit bookkeeping is expected to differ (the agent preset
 * persists reserved `loop`/`exit` channels the eject doesn't declare) so
 * this compares only the shared `messages` contract, not full state equality.
 *
 * Local scripted `BaseChatModel`, not `@harpua/langgraph-testing`: that
 * package peer-depends on this one, so pulling it in here would be a
 * circular workspace/build-graph edge turbo rejects outright (same rationale
 * as agent-boot.spec.ts / agent-middleware.integration.spec.ts).
 */

const EJECT_BASE = Symbol("eject-parity:EJECT_BASE");
const EJECT_BOUND = Symbol("eject-parity:EJECT_BOUND");
const AGENT_BASE = Symbol("eject-parity:AGENT_BASE");

/** Two-turn script: request `lookup_order`, then answer once the tool result
 *  comes back. Identical behavior regardless of which token it's bound under. */
class ScriptedModel extends BaseChatModel {
  private turn = 0;

  constructor() {
    super({ maxRetries: 0 });
  }

  _llmType(): string {
    return "eject-parity-scripted";
  }

  bindTools(_tools: BindToolsInput[]): this {
    return this;
  }

  async _generate(): Promise<ChatResult> {
    this.turn += 1;
    const message =
      this.turn === 1
        ? new AIMessage({
            content: "",
            tool_calls: [
              { name: "lookup_order", args: { id: "42" }, id: "call_1", type: "tool_call" },
            ],
          })
        : new AIMessage("resolved");
    return { generations: [{ message, text: String(message.content) }] };
  }
}

/* ------------------------------------------------------------------ *
 * Eject: hand-written @LangGraph, same loop topology CallModelNode lowers to.
 * ------------------------------------------------------------------ */

const EjectState = new StateSchema({ messages: MessagesValue });

@Injectable()
class EjectCallModel implements NodeHandler<MsgState> {
  constructor(private readonly moduleRef: ModuleRef) {}

  async run(
    state: MsgState,
    config?: LangGraphRunnableConfig,
  ): Promise<Partial<MsgState>> {
    const model = this.moduleRef.get<GraphBoundModel>(EJECT_BOUND, { strict: false });
    const out = await model.invoke(state.messages, config);
    // Coerce an AIMessageChunk to a plain AIMessage, preserving tool_calls —
    // mirrors CallModelNode's own coercion (agent/call-model-node.ts).
    const reply =
      out instanceof AIMessage
        ? out
        : new AIMessage({
            content: (out as any).content ?? "",
            tool_calls: (out as any).tool_calls,
            usage_metadata: (out as any).usage_metadata,
            id: (out as any).id,
          });
    return { messages: [reply] };
  }
}

@LangGraph({ name: "eject", state: EjectState, tools: [OrderTools] })
class EjectGraph {
  edges = defineEdges<MsgState>([
    { from: START, to: EjectCallModel },
    { from: EjectCallModel, to: route<MsgState>(hasToolCalls, [TOOLS, END]) },
    { from: TOOLS, to: EjectCallModel },
  ]);
}

/* ------------------------------------------------------------------ *
 * Agent: the equivalent @LangGraphAgent preset — no middleware, no
 * responseFormat — that should lower to the same loop shape.
 * ------------------------------------------------------------------ */

@LangGraphAgent({
  name: "agentp",
  state: new StateSchema({ messages: MessagesValue }),
  model: AGENT_BASE,
  tools: [OrderTools],
})
class AgentPreset {}

/* ------------------------------------------------------------------ */

const kindsOf = (messages: BaseMessage[]) => messages.map((m) => m._getType());

const toolCallsOf = (messages: BaseMessage[]) =>
  messages
    .filter(isAIMessage)
    .flatMap((m) => m.tool_calls ?? [])
    .map((tc) => ({ name: tc.name, args: tc.args }));

const finalTextOf = (messages: BaseMessage[]) => {
  const aiMessages = messages.filter(isAIMessage);
  return String(aiMessages[aiMessages.length - 1]?.content ?? "");
};

describe("agent eject parity: @LangGraphAgent lowers to the eject shape", () => {
  let ejectApp: INestApplication;
  let agentApp: INestApplication;

  afterEach(async () => {
    await ejectApp?.close();
    await agentApp?.close();
  });

  it("produces the same message-kind sequence, tool call, and final answer as the hand-written eject", async () => {
    const ejectModuleRef = await Test.createTestingModule({
      imports: [
        LangGraphModule.forRoot(),
        LangGraphModule.forFeature([EjectGraph], {
          providers: [
            EjectCallModel,
            OrderTools,
            OrderService,
            { provide: EJECT_BASE, useClass: ScriptedModel },
            provideGraphBoundModel({
              provide: EJECT_BOUND,
              graph: EjectGraph,
              model: EJECT_BASE,
            }),
          ],
        }),
      ],
    }).compile();
    ejectApp = ejectModuleRef.createNestApplication();
    await ejectApp.init();

    const agentModuleRef = await Test.createTestingModule({
      imports: [
        LangGraphModule.forRoot(),
        LangGraphModule.forFeature([AgentPreset], {
          providers: [
            OrderTools,
            OrderService,
            { provide: AGENT_BASE, useClass: ScriptedModel },
          ],
        }),
      ],
    }).compile();
    agentApp = agentModuleRef.createNestApplication();
    await agentApp.init();

    const ejectGraph = ejectApp.get<any>(getGraphFacadeToken({ name: "eject" }));
    const agentGraph = agentApp.get<any>(getGraphFacadeToken({ name: "agentp" }));

    const input = { messages: [new HumanMessage("look up order 42")] };
    const ejectResult: { messages: BaseMessage[] } = await ejectGraph.invoke(input);
    const agentResult: { messages: BaseMessage[] } = await agentGraph.invoke(input);

    // Same sequence of message kinds (human, ai-with-tool-call, tool, ai-final).
    expect(kindsOf(agentResult.messages)).toEqual(kindsOf(ejectResult.messages));

    // Same tool call (name + args) emitted.
    expect(toolCallsOf(agentResult.messages)).toEqual(toolCallsOf(ejectResult.messages));
    expect(toolCallsOf(ejectResult.messages)).toEqual([{ name: "lookup_order", args: { id: "42" } }]);

    // A ToolMessage is present in both runs.
    expect(ejectResult.messages.some((m) => m instanceof ToolMessage)).toBe(true);
    expect(agentResult.messages.some((m) => m instanceof ToolMessage)).toBe(true);

    // Same final AI text.
    expect(finalTextOf(agentResult.messages)).toBe(finalTextOf(ejectResult.messages));
    expect(finalTextOf(ejectResult.messages)).toBe("resolved");
  });
});
