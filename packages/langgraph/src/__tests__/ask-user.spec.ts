import { Injectable } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import type { INestApplication } from "@nestjs/common";
import { AIMessage, HumanMessage, ToolMessage } from "@langchain/core/messages";
import type { BaseMessage } from "@langchain/core/messages";
import { StateSchema, MessagesValue } from "@langchain/langgraph";
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
  askUserTool,
  getGraphFacadeToken,
  type StateOf,
  type LangGraphRunnable,
} from "../index";
import { DEFAULT_DISMISSED_MESSAGE } from "../tools/ask-user/options";

/* ------------------------------------------------------------------ *
 * Schema-level unit tests: prove options are actually wired in,
 * without needing a graph or `interrupt()`.
 * ------------------------------------------------------------------ */

describe("askUserTool: option wiring (schema-level, no interrupt)", () => {
  it("builds its call schema from a custom questionSchema, not the default preset", () => {
    const customSchema = z
      .object({ prompt: z.string(), kind: z.enum(["yesno", "text"]) })
      .strict();
    const t = askUserTool({ questionSchema: customSchema });

    expect(
      t.schema.safeParse({ questions: [{ prompt: "Continue?", kind: "yesno" }] })
        .success,
    ).toBe(true);
    // Valid per the DEFAULT preset shape but NOT the custom one — rejected,
    // proving the custom schema actually replaced the preset.
    expect(
      t.schema.safeParse({ questions: [{ prompt: "Continue?", inputType: "boolean" }] })
        .success,
    ).toBe(false);
  });

  it("rejects an envelope with more than maxQuestions", () => {
    const t = askUserTool({ maxQuestions: 1 });
    expect(
      t.schema.safeParse({
        questions: [
          { prompt: "A?", inputType: "boolean" },
          { prompt: "B?", inputType: "boolean" },
        ],
      }).success,
    ).toBe(false);
  });

  it("rejects an empty questions array", () => {
    const t = askUserTool();
    expect(t.schema.safeParse({ questions: [] }).success).toBe(false);
  });

  it("rejects unknown top-level keys (strict envelope)", () => {
    const t = askUserTool();
    expect(
      t.schema.safeParse({
        questions: [{ prompt: "A?", inputType: "boolean" }],
        extra: true,
      }).success,
    ).toBe(false);
  });
});

/* ------------------------------------------------------------------ *
 * Integration: askUserTool inside a real graph — mirrors
 * tool-approval.spec.ts's "raw approval-gated tool" pattern (ask_user is a
 * raw StructuredToolInterface, not a provider-bound @LangGraphTool method).
 * ------------------------------------------------------------------ */

const MessagesState = new StateSchema({ messages: MessagesValue });
type MsgState = StateOf<typeof MessagesState>;

function hasToolCalls(state: MsgState): typeof TOOLS | typeof END {
  const last = state.messages[state.messages.length - 1];
  return last instanceof AIMessage && (last.tool_calls?.length ?? 0) > 0
    ? TOOLS
    : END;
}

const defaultAskUser = askUserTool();

@Injectable()
class AskUserModel implements NodeHandler<MsgState> {
  run(state: MsgState) {
    const last = state.messages[state.messages.length - 1];
    if (last instanceof ToolMessage) {
      return { messages: [new AIMessage(`Got answers: ${String(last.content)}`)] };
    }
    return {
      messages: [
        new AIMessage({
          content: "",
          tool_calls: [
            {
              name: "ask_user",
              args: {
                intro: "Quick check before I continue:",
                questions: [
                  { prompt: "Should I proceed?", inputType: "boolean" },
                  {
                    prompt: "Pick a color",
                    inputType: "select",
                    options: ["Red", " Red ", "Blue", "  "],
                  },
                ],
              },
              id: "call_ask",
              type: "tool_call",
            },
          ],
        }),
      ],
    };
  }
}

@LangGraph({ name: "askUser", state: MessagesState, tools: [defaultAskUser] })
class AskUserGraph {
  edges = defineEdges<MsgState>([
    { from: START, to: AskUserModel },
    { from: AskUserModel, to: route<MsgState>(hasToolCalls, [TOOLS, END]) },
    { from: TOOLS, to: AskUserModel },
  ]);
}

describe("askUserTool: default preset, inside a real graph", () => {
  let app: INestApplication;
  let graph: LangGraphRunnable<MsgState>;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        LangGraphModule.forRoot({ checkpointer: { type: "memory" } }),
        LangGraphModule.forFeature([AskUserGraph]),
      ],
      providers: [AskUserModel],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    graph = app.get(getGraphFacadeToken({ name: "askUser" }));
  });

  afterAll(async () => {
    await app?.close();
  });

  it("pauses with an ask_user_request carrying NORMALIZED questions", async () => {
    const paused = (await graph.invoke(
      { messages: [new HumanMessage("go")] },
      { configurable: { thread_id: "ask-pause" } },
    )) as Record<string, unknown>;

    const interrupts = paused.__interrupt__ as Array<{ value: unknown }>;
    expect(interrupts[0].value).toEqual({
      type: "ask_user_request",
      intro: "Quick check before I continue:",
      questions: [
        { prompt: "Should I proceed?", inputType: "boolean" },
        { prompt: "Pick a color", inputType: "select", options: ["Red", "Blue"] },
      ],
    });
  });

  it("resumes with answers: serializes and continues the same turn", async () => {
    await graph.invoke(
      { messages: [new HumanMessage("go")] },
      { configurable: { thread_id: "ask-answer" } },
    );
    const done = (await graph.resume("ask-answer", {
      answers: [true, "Blue"],
    })) as { messages: BaseMessage[] };

    const toolMsgs = done.messages.filter((m) => m instanceof ToolMessage);
    expect(toolMsgs).toHaveLength(1);
    expect(String(toolMsgs[0].content)).toBe(
      "Should I proceed?: yes\nPick a color: Blue",
    );
    const last = done.messages[done.messages.length - 1];
    expect(String(last.content)).toBe(
      "Got answers: Should I proceed?: yes\nPick a color: Blue",
    );
  });

  it("resumes with a dismissal: returns the default dismissedMessage", async () => {
    await graph.invoke(
      { messages: [new HumanMessage("go")] },
      { configurable: { thread_id: "ask-dismiss" } },
    );
    const done = (await graph.resume("ask-dismiss", {
      dismissed: true,
      reason: "no user available",
    })) as { messages: BaseMessage[] };

    const toolMsgs = done.messages.filter((m) => m instanceof ToolMessage);
    expect(String(toolMsgs[0].content)).toBe(DEFAULT_DISMISSED_MESSAGE);
  });

  it("rejects a garbage resume value without executing, as an error ToolMessage", async () => {
    await graph.invoke(
      { messages: [new HumanMessage("go")] },
      { configurable: { thread_id: "ask-garbage" } },
    );
    const done = (await graph.resume("ask-garbage", { foo: "bar" })) as {
      messages: BaseMessage[];
    };

    const toolMsgs = done.messages.filter(
      (m) => m instanceof ToolMessage,
    ) as ToolMessage[];
    expect(toolMsgs[0].status).toBe("error");
    expect(String(toolMsgs[0].content)).toContain(
      "Invalid resume value for ask_user tool 'ask_user'",
    );
  });

  it("rejects an answers-length mismatch without executing, as an error ToolMessage", async () => {
    await graph.invoke(
      { messages: [new HumanMessage("go")] },
      { configurable: { thread_id: "ask-mismatch" } },
    );
    const done = (await graph.resume("ask-mismatch", {
      answers: [true],
    })) as { messages: BaseMessage[] };

    const toolMsgs = done.messages.filter(
      (m) => m instanceof ToolMessage,
    ) as ToolMessage[];
    expect(toolMsgs[0].status).toBe("error");
    expect(String(toolMsgs[0].content)).toContain(
      "expected 2 answer(s) (one per question), received 1",
    );
  });
});

/* ------------------------------------------------------------------ *
 * Custom questionSchema + custom serializer, end to end.
 * ------------------------------------------------------------------ */

const customQuestionSchema = z
  .object({ prompt: z.string(), kind: z.enum(["yesno", "text"]) })
  .strict();
type CustomQuestion = z.infer<typeof customQuestionSchema>;

function customSerializer(
  questions: CustomQuestion[],
  answers: Array<string | string[] | boolean | null>,
): string {
  return questions
    .map((q, i) => `[${q.kind}] ${q.prompt} => ${String(answers[i])}`)
    .join(" | ");
}

const customAskUser = askUserTool<CustomQuestion>({
  questionSchema: customQuestionSchema,
  serializeAnswers: customSerializer,
  dismissedMessage: "(nobody home — carry on)",
});

@Injectable()
class CustomAskUserModel implements NodeHandler<MsgState> {
  run(state: MsgState) {
    const last = state.messages[state.messages.length - 1];
    if (last instanceof ToolMessage) {
      return { messages: [new AIMessage(`Got: ${String(last.content)}`)] };
    }
    return {
      messages: [
        new AIMessage({
          content: "",
          tool_calls: [
            {
              name: "ask_user",
              args: { questions: [{ prompt: "Ready?", kind: "yesno" }] },
              id: "call_custom",
              type: "tool_call",
            },
          ],
        }),
      ],
    };
  }
}

@LangGraph({ name: "customAskUser", state: MessagesState, tools: [customAskUser] })
class CustomAskUserGraph {
  edges = defineEdges<MsgState>([
    { from: START, to: CustomAskUserModel },
    { from: CustomAskUserModel, to: route<MsgState>(hasToolCalls, [TOOLS, END]) },
    { from: TOOLS, to: CustomAskUserModel },
  ]);
}

describe("askUserTool: custom questionSchema + custom serializer, end to end", () => {
  let app: INestApplication;
  let graph: LangGraphRunnable<MsgState>;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        LangGraphModule.forRoot({ checkpointer: { type: "memory" } }),
        LangGraphModule.forFeature([CustomAskUserGraph]),
      ],
      providers: [CustomAskUserModel],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    graph = app.get(getGraphFacadeToken({ name: "customAskUser" }));
  });

  afterAll(async () => {
    await app?.close();
  });

  it("pauses with the custom question shape verbatim (no preset normalization applied)", async () => {
    const paused = (await graph.invoke(
      { messages: [new HumanMessage("go")] },
      { configurable: { thread_id: "custom-pause" } },
    )) as Record<string, unknown>;

    const interrupts = paused.__interrupt__ as Array<{ value: unknown }>;
    expect(interrupts[0].value).toEqual({
      type: "ask_user_request",
      questions: [{ prompt: "Ready?", kind: "yesno" }],
    });
  });

  it("resumes through the custom serializer", async () => {
    await graph.invoke(
      { messages: [new HumanMessage("go")] },
      { configurable: { thread_id: "custom-answer" } },
    );
    const done = (await graph.resume("custom-answer", {
      answers: [true],
    })) as { messages: BaseMessage[] };

    const toolMsgs = done.messages.filter((m) => m instanceof ToolMessage);
    expect(String(toolMsgs[0].content)).toBe("[yesno] Ready? => true");
  });

  it("returns the CUSTOM dismissedMessage on a dismissal resume", async () => {
    await graph.invoke(
      { messages: [new HumanMessage("go")] },
      { configurable: { thread_id: "custom-dismiss" } },
    );
    const done = (await graph.resume("custom-dismiss", {
      dismissed: true,
    })) as { messages: BaseMessage[] };

    const toolMsgs = done.messages.filter((m) => m instanceof ToolMessage);
    expect(String(toolMsgs[0].content)).toBe("(nobody home — carry on)");
  });
});

/* ------------------------------------------------------------------ *
 * A throwing custom serializer propagates — no try/catch swallows it,
 * mirroring the "no try/catch around interrupt()" rule for the one other
 * user-supplied function call in the flow.
 * ------------------------------------------------------------------ */

const throwingAskUser = askUserTool({
  serializeAnswers: () => {
    throw new Error("serializeAnswers kaboom");
  },
});

@Injectable()
class ThrowingAskUserModel implements NodeHandler<MsgState> {
  run(state: MsgState) {
    const last = state.messages[state.messages.length - 1];
    if (last instanceof ToolMessage) {
      return { messages: [new AIMessage(`Got: ${String(last.content)}`)] };
    }
    return {
      messages: [
        new AIMessage({
          content: "",
          tool_calls: [
            {
              name: "ask_user",
              args: { questions: [{ prompt: "Continue?", inputType: "boolean" }] },
              id: "call_throw",
              type: "tool_call",
            },
          ],
        }),
      ],
    };
  }
}

@LangGraph({
  name: "throwingAskUser",
  state: MessagesState,
  tools: [throwingAskUser],
})
class ThrowingAskUserGraph {
  edges = defineEdges<MsgState>([
    { from: START, to: ThrowingAskUserModel },
    { from: ThrowingAskUserModel, to: route<MsgState>(hasToolCalls, [TOOLS, END]) },
    { from: TOOLS, to: ThrowingAskUserModel },
  ]);
}

describe("askUserTool: a throwing custom serializeAnswers propagates", () => {
  let app: INestApplication;
  let graph: LangGraphRunnable<MsgState>;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        LangGraphModule.forRoot({ checkpointer: { type: "memory" } }),
        LangGraphModule.forFeature([ThrowingAskUserGraph]),
      ],
      providers: [ThrowingAskUserModel],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    graph = app.get(getGraphFacadeToken({ name: "throwingAskUser" }));
  });

  afterAll(async () => {
    await app?.close();
  });

  it("surfaces the serializer's throw as an error ToolMessage, never a fallback string", async () => {
    await graph.invoke(
      { messages: [new HumanMessage("go")] },
      { configurable: { thread_id: "throw-serialize" } },
    );
    const done = (await graph.resume("throw-serialize", {
      answers: [true],
    })) as { messages: BaseMessage[] };

    const toolMsgs = done.messages.filter(
      (m) => m instanceof ToolMessage,
    ) as ToolMessage[];
    expect(toolMsgs[0].status).toBe("error");
    expect(String(toolMsgs[0].content)).toContain("serializeAnswers kaboom");
  });
});
