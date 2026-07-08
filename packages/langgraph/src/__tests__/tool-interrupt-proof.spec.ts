import { Injectable } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import type { INestApplication } from "@nestjs/common";
import { AIMessage, HumanMessage, ToolMessage } from "@langchain/core/messages";
import type { BaseMessage } from "@langchain/core/messages";
import { StateSchema, MessagesValue } from "@langchain/langgraph";
import { tool } from "@langchain/core/tools";
import { z } from "zod";

import {
  LangGraph,
  LangGraphModule,
  NodeHandler,
  START,
  END,
  TOOLS,
  defineEdges,
  route,
  interrupt,
  getGraphFacadeToken,
  type StateOf,
  type LangGraphRunnable,
} from "../index";

/*
 * EMPIRICAL PROOF (must pass before the approval-gated-tools feature is built on
 * it): does LangGraph's `interrupt()` actually work when called from *inside* a
 * tool that a `ToolNode` executes? `interrupt()` reads the run context via
 * `AsyncLocalStorageProviderSingleton.getRunnableConfig()`, so in principle the
 * ToolNode's execution context should carry it — but that is exactly the kind of
 * assumption the task says to prove, not assume. This spec calls `interrupt()`
 * raw inside a tool's function and asserts the pause + resume round-trips.
 */

const MessagesState = new StateSchema({ messages: MessagesValue });
type MsgState = StateOf<typeof MessagesState>;

const executed: string[] = [];

// A raw tool whose function pauses via interrupt() BEFORE doing its work, then
// completes with the resume value once resumed.
const gatedTool = tool(
  (input: { value: string }) => {
    const decision = interrupt({ ask: "approve?", value: input.value }) as {
      approved: boolean;
    };
    if (!decision.approved) return "declined";
    executed.push(input.value);
    return `did:${input.value}`;
  },
  {
    name: "gated",
    description: "A tool that requires approval mid-execution.",
    schema: z.object({ value: z.string() }),
  },
);

@Injectable()
class ToolCallerModel implements NodeHandler<MsgState> {
  run(state: MsgState) {
    const last = state.messages[state.messages.length - 1];
    if (last instanceof ToolMessage) {
      return { messages: [new AIMessage(`final: ${String(last.content)}`)] };
    }
    return {
      messages: [
        new AIMessage({
          content: "",
          tool_calls: [
            { name: "gated", args: { value: "X" }, id: "c1", type: "tool_call" },
          ],
        }),
      ],
    };
  }
}

function hasToolCalls(state: MsgState): typeof TOOLS | typeof END {
  const last = state.messages[state.messages.length - 1];
  return last instanceof AIMessage && (last.tool_calls?.length ?? 0) > 0
    ? TOOLS
    : END;
}

@LangGraph({ name: "gatedProof", state: MessagesState, tools: [gatedTool] })
class GatedProofGraph {
  edges = defineEdges<MsgState>([
    { from: START, to: ToolCallerModel },
    { from: ToolCallerModel, to: route<MsgState>(hasToolCalls, [TOOLS, END]) },
    { from: TOOLS, to: ToolCallerModel },
  ]);
}

describe("PROOF: interrupt() inside a ToolNode-executed tool", () => {
  let app: INestApplication;
  let graph: LangGraphRunnable<MsgState>;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        LangGraphModule.forRoot({ checkpointer: { type: "memory" } }),
        LangGraphModule.forFeature([GatedProofGraph]),
      ],
      providers: [ToolCallerModel],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    graph = app.get(getGraphFacadeToken({ name: "gatedProof" }));
  });

  afterAll(async () => {
    await app?.close();
  });

  beforeEach(() => {
    executed.length = 0;
  });

  it("pauses at the in-tool interrupt(), surfacing the payload", async () => {
    const paused = (await graph.invoke(
      { messages: [new HumanMessage("go")] },
      { configurable: { thread_id: "proof-pause" } },
    )) as Record<string, unknown>;

    expect(paused.__interrupt__).toBeDefined();
    const interrupts = paused.__interrupt__ as Array<{ value: unknown }>;
    expect(interrupts[0].value).toEqual({ ask: "approve?", value: "X" });
    // The tool body did NOT run past the interrupt.
    expect(executed).toEqual([]);
  });

  it("resumes into the same tool call and completes with the resume value (approve)", async () => {
    await graph.invoke(
      { messages: [new HumanMessage("go")] },
      { configurable: { thread_id: "proof-approve" } },
    );

    const done = (await graph.resume("proof-approve", { approved: true })) as {
      messages: BaseMessage[];
    };

    // The tool ran exactly once, with the ORIGINAL args, after resume.
    expect(executed).toEqual(["X"]);
    const toolMsgs = done.messages.filter((m) => m instanceof ToolMessage);
    expect(toolMsgs).toHaveLength(1);
    expect(String(toolMsgs[0].content)).toBe("did:X");
    const last = done.messages[done.messages.length - 1];
    expect(String(last.content)).toBe("final: did:X");
  });

  it("resumes with a decline and the tool body short-circuits", async () => {
    await graph.invoke(
      { messages: [new HumanMessage("go")] },
      { configurable: { thread_id: "proof-decline" } },
    );

    const done = (await graph.resume("proof-decline", { approved: false })) as {
      messages: BaseMessage[];
    };

    expect(executed).toEqual([]);
    const toolMsgs = done.messages.filter((m) => m instanceof ToolMessage);
    expect(String(toolMsgs[0].content)).toBe("declined");
  });
});
