import { Inject, Injectable } from "@nestjs/common";
import type { INestApplication } from "@nestjs/common";
import { ModuleRef } from "@nestjs/core";
import { Test } from "@nestjs/testing";
import {
  AIMessage,
  HumanMessage,
  ToolMessage,
  type BaseMessage,
} from "@langchain/core/messages";
import {
  BaseChatModel,
  type BindToolsInput,
} from "@langchain/core/language_models/chat_models";
import type { ChatResult } from "@langchain/core/outputs";
import { tool } from "@langchain/core/tools";
import { StateSchema, MessagesValue } from "@langchain/langgraph";
import { ToolNode } from "@langchain/langgraph/prebuilt";
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
  getGraphFacadeToken,
  buildGraphTools,
  getGraphToolsToken,
  provideGraphTools,
  provideGraphBoundModel,
  type GraphBoundModel,
  type StateOf,
  type LangGraphRunnable,
} from "../index";
import { OrderService, OrderTools } from "./fixtures";

const MessagesState = new StateSchema({ messages: MessagesValue });
type MsgState = StateOf<typeof MessagesState>;

function contentOf(message: BaseMessage): string {
  return typeof message.content === "string"
    ? message.content
    : JSON.stringify(message.content);
}

// A raw LangChain tool instance mounted alongside the provider class.
const echoTool = tool((input: { text: string }) => `echoed:${input.text}`, {
  name: "echo",
  description: "Echo the given text back.",
  schema: z.object({ text: z.string() }),
});

// Minimal edges so these graphs are structurally valid; only the metadata
// (`tools`) is read by the binding helpers unless the graph is compiled.
const toolLoop = defineEdges<MsgState>([
  { from: START, to: END },
]);

@LangGraph({ name: "boundTools", state: MessagesState, tools: [OrderTools, echoTool] })
class BoundToolsGraph {
  edges = toolLoop;
}

@LangGraph({ name: "noTools", state: MessagesState })
class NoToolsGraph {
  edges = toolLoop;
}

const BOUND_MODEL = Symbol.for("test:BOUND_MODEL");
const RAW_MODEL = Symbol.for("test:RAW_MODEL");

/* ------------------------------------------------------------------ */
/* 1. The tool array matches what the ToolNode mounts                  */
/* ------------------------------------------------------------------ */

describe("buildGraphTools", () => {
  let app: INestApplication;
  let moduleRef: ModuleRef;

  beforeAll(async () => {
    const built = await Test.createTestingModule({
      providers: [OrderService, OrderTools],
    }).compile();
    app = built.createNestApplication();
    await app.init();
    moduleRef = app.get(ModuleRef);
  });

  afterAll(async () => {
    await app?.close();
  });

  it("produces the same tools (name + schema) the ToolNode receives, for provider + raw entries", () => {
    const tools = buildGraphTools(BoundToolsGraph, moduleRef);
    // The ToolNode is built from this very array in the registry, so its
    // mounted tools are identical — proving the model binds exactly what the
    // executor runs.
    const node = new ToolNode(tools);

    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual(["echo", "lookup_order"]);
    expect(node.tools.map((t) => t.name).sort()).toEqual(names);
    expect(node.tools).toHaveLength(tools.length);

    // The provider method's zod schema reaches the tool the model would bind.
    const lookup = tools.find((t) => t.name === "lookup_order")!;
    expect(lookup.schema).toBeDefined();
    const parsed = (lookup.schema as z.ZodTypeAny).safeParse({ id: "42" });
    expect(parsed.success).toBe(true);
  });

  it("returns an empty array for a graph with no tools", () => {
    expect(buildGraphTools(NoToolsGraph, moduleRef)).toEqual([]);
  });

  it("exposes the array via provideGraphTools under getGraphToolsToken", async () => {
    const built = await Test.createTestingModule({
      providers: [OrderService, OrderTools, provideGraphTools({ graph: BoundToolsGraph })],
    }).compile();
    const inner = built.createNestApplication();
    await inner.init();
    try {
      const tools = inner.get(getGraphToolsToken(BoundToolsGraph));
      expect(tools.map((t: { name: string }) => t.name).sort()).toEqual([
        "echo",
        "lookup_order",
      ]);
    } finally {
      await inner.close();
    }
  });
});

/* ------------------------------------------------------------------ */
/* 2. provideGraphBoundModel calls bindTools with that array          */
/* ------------------------------------------------------------------ */

// Records what it was asked to bind; bindTools returns `this` (the mock/no-op
// arm every real BaseChatModel and the demo mocks use).
@Injectable()
class RecordingModel extends BaseChatModel {
  public boundTools: BindToolsInput[] | undefined;

  constructor() {
    super({});
  }

  _llmType(): string {
    return "recording";
  }

  bindTools(tools: BindToolsInput[]): this {
    this.boundTools = tools;
    return this;
  }

  async _generate(): Promise<ChatResult> {
    const message = new AIMessage("ok");
    return { generations: [{ message, text: "ok" }] };
  }
}

describe("provideGraphBoundModel", () => {
  it("binds the graph's tools to the model (records the bindTools args)", async () => {
    const built = await Test.createTestingModule({
      providers: [
        OrderService,
        OrderTools,
        { provide: RAW_MODEL, useClass: RecordingModel },
        provideGraphBoundModel({
          provide: BOUND_MODEL,
          graph: BoundToolsGraph,
          model: RAW_MODEL,
        }),
      ],
    }).compile();
    const app = built.createNestApplication();
    await app.init();
    try {
      const bound = app.get(BOUND_MODEL);
      const raw = app.get<RecordingModel>(RAW_MODEL);
      // bindTools returned `this`, so the bound token is the same instance.
      expect(bound).toBe(raw);
      expect(raw.boundTools).toBeDefined();
      const boundNames = (raw.boundTools as { name: string }[])
        .map((t) => t.name)
        .sort();
      expect(boundNames).toEqual(["echo", "lookup_order"]);
    } finally {
      await app.close();
    }
  });

  it("returns the model unchanged when the graph has no tools", async () => {
    const built = await Test.createTestingModule({
      providers: [
        { provide: RAW_MODEL, useClass: RecordingModel },
        provideGraphBoundModel({
          provide: BOUND_MODEL,
          graph: NoToolsGraph,
          model: RAW_MODEL,
        }),
      ],
    }).compile();
    const app = built.createNestApplication();
    await app.init();
    try {
      const bound = app.get(BOUND_MODEL);
      const raw = app.get<RecordingModel>(RAW_MODEL);
      expect(bound).toBe(raw);
      // bindTools was never called.
      expect(raw.boundTools).toBeUndefined();
    } finally {
      await app.close();
    }
  });
});

/* ------------------------------------------------------------------ */
/* 3. e2e: the binding actually reaches the model                     */
/* ------------------------------------------------------------------ */

// A model that ONLY emits a tool call when it was GIVEN the tool via bindTools.
// Unbound (boundTools empty) it can only answer in plain text. So a tool call
// running through the graph proves the binding reached the model — not the
// ToolNode, which never talks to the model.
@Injectable()
class BindingProbeModel extends BaseChatModel {
  constructor(private readonly boundTools: BindToolsInput[] = []) {
    super({});
  }

  _llmType(): string {
    return "binding-probe";
  }

  bindTools(tools: BindToolsInput[]): BindingProbeModel {
    return new BindingProbeModel(tools);
  }

  async _generate(messages: BaseMessage[]): Promise<ChatResult> {
    const last = messages[messages.length - 1];
    let message: AIMessage;
    if (last instanceof ToolMessage) {
      message = new AIMessage(`Final: ${contentOf(last)}`);
    } else if (this.boundTools.length > 0) {
      message = new AIMessage({
        content: "",
        tool_calls: [
          { name: "lookup_order", args: { id: "42" }, id: "c1", type: "tool_call" },
        ],
      });
    } else {
      message = new AIMessage("I have no tools, so here is a plain answer.");
    }
    return {
      generations: [
        { message, text: typeof message.content === "string" ? message.content : "" },
      ],
    };
  }
}

@Injectable()
class ProbeCallModel implements NodeHandler<MsgState> {
  constructor(@Inject(BOUND_MODEL) private readonly model: GraphBoundModel) {}
  async run(state: MsgState) {
    return { messages: [await this.model.invoke(state.messages)] };
  }
}

function hasToolCalls(state: MsgState): typeof TOOLS | typeof END {
  const last = state.messages[state.messages.length - 1];
  return last instanceof AIMessage && (last.tool_calls?.length ?? 0) > 0
    ? TOOLS
    : END;
}

@LangGraph({ name: "probe", state: MessagesState, tools: [OrderTools] })
class ProbeGraph {
  edges = defineEdges<MsgState>([
    { from: START, to: ProbeCallModel },
    { from: ProbeCallModel, to: route<MsgState>(hasToolCalls, [TOOLS, END]) },
    { from: TOOLS, to: ProbeCallModel },
  ]);
}

describe("bound model drives a real compiled graph end to end", () => {
  it("an unbound probe model emits no tool call (proves the gating)", async () => {
    const model = new BindingProbeModel();
    const reply = await model.invoke([new HumanMessage("look up order 42")]);
    expect(reply.tool_calls ?? []).toHaveLength(0);
  });

  it("binding lets the model emit the tool call, and the loop runs it via DI", async () => {
    const built = await Test.createTestingModule({
      imports: [
        LangGraphModule.forRoot(),
        LangGraphModule.forFeature([ProbeGraph]),
      ],
      providers: [
        OrderService,
        OrderTools,
        ProbeCallModel,
        { provide: RAW_MODEL, useValue: new BindingProbeModel() },
        provideGraphBoundModel({
          provide: BOUND_MODEL,
          graph: ProbeGraph,
          model: RAW_MODEL,
        }),
      ],
    }).compile();
    const app = built.createNestApplication();
    await app.init();
    try {
      const orderService = app.get(OrderService);
      const agent = app.get<LangGraphRunnable<MsgState>>(
        getGraphFacadeToken({ name: "probe" }),
      );
      const result = (await agent.invoke({
        messages: [new HumanMessage("look up order 42")],
      })) as { messages: BaseMessage[] };

      // The tool ran through its injected service (proves ToolNode executed it).
      expect(orderService.calls).toContain("42");
      // The final assistant message summarizes the tool result.
      const last = result.messages[result.messages.length - 1];
      expect(last).toBeInstanceOf(AIMessage);
      expect(contentOf(last)).toContain("shipped");
    } finally {
      await app.close();
    }
  });
});
