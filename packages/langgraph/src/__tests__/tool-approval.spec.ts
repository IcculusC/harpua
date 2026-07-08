import { Inject, Injectable } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import type { INestApplication } from "@nestjs/common";
import { ModuleRef } from "@nestjs/core";
import { AIMessage, HumanMessage, ToolMessage } from "@langchain/core/messages";
import type { BaseMessage } from "@langchain/core/messages";
import { StateSchema, MessagesValue } from "@langchain/langgraph";
import { tool } from "@langchain/core/tools";
import { context, trace } from "@opentelemetry/api";
import type { ReadableSpan } from "@opentelemetry/sdk-trace-node";
import {
  InMemorySpanExporter,
  NodeTracerProvider,
  SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-node";
import { z } from "zod";

import {
  LangGraph,
  LangGraphTool,
  LangGraphModule,
  NodeHandler,
  START,
  END,
  TOOLS,
  defineEdges,
  route,
  buildGraphTools,
  requireApproval,
  getGraphFacadeToken,
  type StateOf,
  type LangGraphRunnable,
} from "../index";
import { resetOtelCache } from "../observability";

/* ------------------------------------------------------------------ *
 * Approval-gated tools: enforcement lives in buildGraphTools, so both
 * the ToolNode execution path and the model-bound schemas are covered.
 * ------------------------------------------------------------------ */

const MessagesState = new StateSchema({ messages: MessagesValue });
type MsgState = StateOf<typeof MessagesState>;

// A shared side-effect log proving the REAL tool ran (or didn't).
@Injectable()
class CancelService {
  readonly cancelled: string[] = [];
  cancel(orderId: string): string {
    this.cancelled.push(orderId);
    return `Order ${orderId} has been cancelled.`;
  }
}

const cancelSchema = z.object({ orderId: z.string() });
const cancelDescription = "Cancel an order by its id.";

// Flagged provider tool.
@Injectable()
class GatedCancelTools {
  constructor(private readonly svc: CancelService) {}
  @LangGraphTool({
    name: "cancel_order",
    description: cancelDescription,
    schema: cancelSchema,
    requiresApproval: true,
  })
  cancelOrder(input: { orderId: string }): string {
    return this.svc.cancel(input.orderId);
  }
}

// Same name/description/schema, but UNflagged — used to prove the model-facing
// tool is identical whether or not the approval flag is set.
@Injectable()
class PlainCancelTools {
  constructor(private readonly svc: CancelService) {}
  @LangGraphTool({
    name: "cancel_order",
    description: cancelDescription,
    schema: cancelSchema,
  })
  cancelOrder(input: { orderId: string }): string {
    return this.svc.cancel(input.orderId);
  }
}

// Scripted model: emit the cancel_order call first, summarise once a tool
// result is present.
@Injectable()
class CancelModel implements NodeHandler<MsgState> {
  run(state: MsgState) {
    const last = state.messages[state.messages.length - 1];
    if (last instanceof ToolMessage) {
      return { messages: [new AIMessage(`Result: ${String(last.content)}`)] };
    }
    return {
      messages: [
        new AIMessage({
          content: "",
          tool_calls: [
            {
              name: "cancel_order",
              args: { orderId: "7" },
              id: "call_cancel",
              type: "tool_call",
            },
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

@LangGraph({ name: "gatedApproval", state: MessagesState, tools: [GatedCancelTools] })
class GatedApprovalGraph {
  edges = defineEdges<MsgState>([
    { from: START, to: CancelModel },
    { from: CancelModel, to: route<MsgState>(hasToolCalls, [TOOLS, END]) },
    { from: TOOLS, to: CancelModel },
  ]);
}

@LangGraph({ name: "plainApproval", state: MessagesState, tools: [PlainCancelTools] })
class PlainApprovalGraph {
  edges = defineEdges<MsgState>([{ from: START, to: END }]);
}

/* ------------------------------------------------------------------ *
 * Raw approval-gated tool
 * ------------------------------------------------------------------ */

const rawRuns: string[] = [];
const rawDanger = requireApproval(
  tool(
    (input: { target: string }) => {
      rawRuns.push(input.target);
      return `wiped:${input.target}`;
    },
    {
      name: "wipe",
      description: "Wipe a target — destructive.",
      schema: z.object({ target: z.string() }),
    },
  ),
);

@Injectable()
class WipeModel implements NodeHandler<MsgState> {
  run(state: MsgState) {
    const last = state.messages[state.messages.length - 1];
    if (last instanceof ToolMessage) {
      return { messages: [new AIMessage(`Result: ${String(last.content)}`)] };
    }
    return {
      messages: [
        new AIMessage({
          content: "",
          tool_calls: [
            {
              name: "wipe",
              args: { target: "db" },
              id: "call_wipe",
              type: "tool_call",
            },
          ],
        }),
      ],
    };
  }
}

@LangGraph({ name: "rawApproval", state: MessagesState, tools: [rawDanger] })
class RawApprovalGraph {
  edges = defineEdges<MsgState>([
    { from: START, to: WipeModel },
    { from: WipeModel, to: route<MsgState>(hasToolCalls, [TOOLS, END]) },
    { from: TOOLS, to: WipeModel },
  ]);
}

/* ------------------------------------------------------------------ */

describe("approval-gated provider tool", () => {
  let app: INestApplication;
  let graph: LangGraphRunnable<MsgState>;
  let svc: CancelService;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        LangGraphModule.forRoot({ checkpointer: { type: "memory" } }),
        LangGraphModule.forFeature([GatedApprovalGraph]),
      ],
      providers: [CancelModel, CancelService, GatedCancelTools],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    graph = app.get(getGraphFacadeToken({ name: "gatedApproval" }));
    svc = app.get(CancelService);
  });

  afterAll(async () => {
    await app?.close();
  });

  beforeEach(() => {
    svc.cancelled.length = 0;
  });

  it("pauses with a tool_approval_request before executing", async () => {
    const paused = (await graph.invoke(
      { messages: [new HumanMessage("cancel it")] },
      { configurable: { thread_id: "gate-pause" } },
    )) as Record<string, unknown>;

    const interrupts = paused.__interrupt__ as Array<{ value: unknown }>;
    expect(interrupts[0].value).toEqual({
      type: "tool_approval_request",
      tool: "cancel_order",
      args: { orderId: "7" },
    });
    // The real tool has NOT run.
    expect(svc.cancelled).toEqual([]);
  });

  it("approved: executes the tool exactly once with the original args", async () => {
    await graph.invoke(
      { messages: [new HumanMessage("cancel it")] },
      { configurable: { thread_id: "gate-approve" } },
    );
    const done = (await graph.resume("gate-approve", { approved: true })) as {
      messages: BaseMessage[];
    };

    expect(svc.cancelled).toEqual(["7"]); // once, with the original id
    const toolMsgs = done.messages.filter((m) => m instanceof ToolMessage);
    expect(toolMsgs).toHaveLength(1);
    expect(String(toolMsgs[0].content)).toBe("Order 7 has been cancelled.");
    const last = done.messages[done.messages.length - 1];
    expect(String(last.content)).toContain("Order 7 has been cancelled");
  });

  it("declined: never executes and returns the decline message", async () => {
    await graph.invoke(
      { messages: [new HumanMessage("cancel it")] },
      { configurable: { thread_id: "gate-decline" } },
    );
    const done = (await graph.resume("gate-decline", {
      approved: false,
      reason: "changed my mind",
    })) as { messages: BaseMessage[] };

    expect(svc.cancelled).toEqual([]);
    const toolMsgs = done.messages.filter((m) => m instanceof ToolMessage);
    expect(String(toolMsgs[0].content)).toBe(
      "The user declined cancel_order: changed my mind.",
    );
  });

  it("declined without a reason uses the 'no reason given' fallback", async () => {
    await graph.invoke(
      { messages: [new HumanMessage("cancel it")] },
      { configurable: { thread_id: "gate-decline-noreason" } },
    );
    const done = (await graph.resume("gate-decline-noreason", {
      approved: false,
    })) as { messages: BaseMessage[] };

    const toolMsgs = done.messages.filter((m) => m instanceof ToolMessage);
    expect(String(toolMsgs[0].content)).toBe(
      "The user declined cancel_order: no reason given.",
    );
  });

  it("rejects a malformed resume value with a clear error, without executing", async () => {
    await graph.invoke(
      { messages: [new HumanMessage("cancel it")] },
      { configurable: { thread_id: "gate-badshape" } },
    );
    // { ok: 1 } has no `approved` boolean — the zod resume schema rejects it.
    // ToolNode surfaces the thrown error as an error ToolMessage; the tool never
    // runs, so a malformed decision can NEVER be mistaken for an approval.
    const done = (await graph.resume("gate-badshape", { ok: 1 })) as {
      messages: BaseMessage[];
    };

    expect(svc.cancelled).toEqual([]);
    const toolMsgs = done.messages.filter(
      (m) => m instanceof ToolMessage,
    ) as ToolMessage[];
    expect(toolMsgs[0].status).toBe("error");
    expect(String(toolMsgs[0].content)).toContain(
      "Invalid resume value for approval-gated tool 'cancel_order'",
    );
  });
});

describe("approval-gated raw tool", () => {
  let app: INestApplication;
  let graph: LangGraphRunnable<MsgState>;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        LangGraphModule.forRoot({ checkpointer: { type: "memory" } }),
        LangGraphModule.forFeature([RawApprovalGraph]),
      ],
      providers: [WipeModel],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    graph = app.get(getGraphFacadeToken({ name: "rawApproval" }));
  });

  afterAll(async () => {
    await app?.close();
  });

  beforeEach(() => {
    rawRuns.length = 0;
  });

  it("pauses a requireApproval()-marked raw tool before it runs", async () => {
    const paused = (await graph.invoke(
      { messages: [new HumanMessage("wipe it")] },
      { configurable: { thread_id: "raw-pause" } },
    )) as Record<string, unknown>;

    const interrupts = paused.__interrupt__ as Array<{ value: unknown }>;
    expect(interrupts[0].value).toEqual({
      type: "tool_approval_request",
      tool: "wipe",
      args: { target: "db" },
    });
    expect(rawRuns).toEqual([]);
  });

  it("approved: runs the raw tool once, declined: never runs it", async () => {
    await graph.invoke(
      { messages: [new HumanMessage("wipe it")] },
      { configurable: { thread_id: "raw-approve" } },
    );
    const approved = (await graph.resume("raw-approve", { approved: true })) as {
      messages: BaseMessage[];
    };
    expect(rawRuns).toEqual(["db"]);
    const okMsg = approved.messages.find((m) => m instanceof ToolMessage)!;
    expect(String(okMsg.content)).toBe("wiped:db");

    rawRuns.length = 0;
    await graph.invoke(
      { messages: [new HumanMessage("wipe it")] },
      { configurable: { thread_id: "raw-decline" } },
    );
    const declined = (await graph.resume("raw-decline", {
      approved: false,
    })) as { messages: BaseMessage[] };
    expect(rawRuns).toEqual([]);
    const declineMsg = declined.messages.find((m) => m instanceof ToolMessage)!;
    expect(String(declineMsg.content)).toBe(
      "The user declined wipe: no reason given.",
    );
  });
});

describe("a flagged tool's model-facing schema is identical to an unflagged one", () => {
  it("buildGraphTools exposes the same name/description/schema either way", async () => {
    const built = await Test.createTestingModule({
      providers: [CancelService, GatedCancelTools, PlainCancelTools],
    }).compile();
    const app = built.createNestApplication();
    await app.init();
    try {
      const moduleRef = app.get(ModuleRef);
      const [gated] = buildGraphTools(GatedApprovalGraph, moduleRef);
      const [plain] = buildGraphTools(PlainApprovalGraph, moduleRef);

      // What the model binds is identical: same name, description, and schema.
      expect(gated.name).toBe(plain.name);
      expect(gated.description).toBe(plain.description);
      expect(gated.schema).toBe(cancelSchema);
      expect(plain.schema).toBe(cancelSchema);
    } finally {
      await app.close();
    }
  });
});

describe("approval-gated tool observability", () => {
  const exporter = new InMemorySpanExporter();
  const provider = new NodeTracerProvider({
    spanProcessors: [new SimpleSpanProcessor(exporter)],
  });
  let app: INestApplication;
  let graph: LangGraphRunnable<MsgState>;

  beforeAll(async () => {
    provider.register();
    const moduleRef = await Test.createTestingModule({
      imports: [
        LangGraphModule.forRoot({ checkpointer: { type: "memory" } }),
        LangGraphModule.forFeature([GatedApprovalGraph]),
      ],
      providers: [CancelModel, CancelService, GatedCancelTools],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    graph = app.get(getGraphFacadeToken({ name: "gatedApproval" }));
  });

  afterAll(async () => {
    await app?.close();
    await provider.shutdown();
    trace.disable();
    context.disable();
  });

  beforeEach(() => {
    resetOtelCache();
    exporter.reset();
  });

  it("emits the langgraph.tool span on the approved (execution) pass", async () => {
    await graph.invoke(
      { messages: [new HumanMessage("cancel it")] },
      { configurable: { thread_id: "span-approve" } },
    );
    // The pause pass throws GraphInterrupt BEFORE instrumentTool runs, so no
    // tool span there; the span covers only real execution after approval.
    expect(
      exporter
        .getFinishedSpans()
        .filter((s: ReadableSpan) => s.name === "langgraph.tool cancel_order"),
    ).toHaveLength(0);

    exporter.reset();
    await graph.resume("span-approve", { approved: true });

    const toolSpans = exporter
      .getFinishedSpans()
      .filter((s: ReadableSpan) => s.name === "langgraph.tool cancel_order");
    expect(toolSpans).toHaveLength(1);
    expect(toolSpans[0].attributes["langgraph.tool.name"]).toBe("cancel_order");
  });
});
