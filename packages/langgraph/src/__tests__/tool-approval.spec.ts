import { Inject, Injectable, Logger } from "@nestjs/common";
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

/* ------------------------------------------------------------------ *
 * Customizable approval + decline wording
 * ------------------------------------------------------------------ */

// Records the args each message builder actually receives, to prove the gate
// hands the real tool-call args to the builder.
const approvalArgsSeen: unknown[] = [];

// Provider tool with BOTH custom builders. approvalMessage zod-parses its args
// (never assumes their shape); declineMessage weaves in the reason.
@Injectable()
class MessagedCancelTools {
  constructor(private readonly svc: CancelService) {}
  @LangGraphTool({
    name: "cancel_order",
    description: cancelDescription,
    schema: cancelSchema,
    requiresApproval: true,
    approvalMessage: (args) => {
      approvalArgsSeen.push(args);
      const { orderId } = cancelSchema.parse(args);
      return `Permanently cancel order ${orderId}? This cannot be undone.`;
    },
    declineMessage: (args, reason) => {
      const { orderId } = cancelSchema.parse(args);
      return `Kept order ${orderId} intact${reason ? `: ${reason}` : ""}.`;
    },
  })
  cancelOrder(input: { orderId: string }): string {
    return this.svc.cancel(input.orderId);
  }
}

// Provider tool whose approvalMessage THROWS — must not corrupt the flow.
@Injectable()
class ThrowingMsgCancelTools {
  constructor(private readonly svc: CancelService) {}
  @LangGraphTool({
    name: "cancel_order",
    description: cancelDescription,
    schema: cancelSchema,
    requiresApproval: true,
    approvalMessage: () => {
      throw new Error("approvalMessage kaboom");
    },
  })
  cancelOrder(input: { orderId: string }): string {
    return this.svc.cancel(input.orderId);
  }
}

@LangGraph({
  name: "messagedApproval",
  state: MessagesState,
  tools: [MessagedCancelTools],
})
class MessagedApprovalGraph {
  edges = defineEdges<MsgState>([
    { from: START, to: CancelModel },
    { from: CancelModel, to: route<MsgState>(hasToolCalls, [TOOLS, END]) },
    { from: TOOLS, to: CancelModel },
  ]);
}

@LangGraph({
  name: "throwingApproval",
  state: MessagesState,
  tools: [ThrowingMsgCancelTools],
})
class ThrowingApprovalGraph {
  edges = defineEdges<MsgState>([
    { from: START, to: CancelModel },
    { from: CancelModel, to: route<MsgState>(hasToolCalls, [TOOLS, END]) },
    { from: TOOLS, to: CancelModel },
  ]);
}

// Raw tool with custom wording, carried on the requireApproval() marker.
const rawMsgRuns: string[] = [];
const rawMessagedDanger = requireApproval(
  tool(
    (input: { target: string }) => {
      rawMsgRuns.push(input.target);
      return `wiped:${input.target}`;
    },
    {
      name: "wipe",
      description: "Wipe a target — destructive.",
      schema: z.object({ target: z.string() }),
    },
  ),
  {
    approvalMessage: (args) => {
      const { target } = z.object({ target: z.string() }).parse(args);
      return `Really wipe ${target}? This is irreversible.`;
    },
    declineMessage: (args, reason) => {
      const { target } = z.object({ target: z.string() }).parse(args);
      return `Left ${target} untouched${reason ? ` (${reason})` : ""}.`;
    },
  },
);

@LangGraph({
  name: "rawMessagedApproval",
  state: MessagesState,
  tools: [rawMessagedDanger],
})
class RawMessagedApprovalGraph {
  edges = defineEdges<MsgState>([
    { from: START, to: WipeModel },
    { from: WipeModel, to: route<MsgState>(hasToolCalls, [TOOLS, END]) },
    { from: TOOLS, to: WipeModel },
  ]);
}

describe("customizable approval + decline wording", () => {
  describe("provider tool", () => {
    let app: INestApplication;
    let graph: LangGraphRunnable<MsgState>;
    let svc: CancelService;

    beforeAll(async () => {
      const moduleRef = await Test.createTestingModule({
        imports: [
          LangGraphModule.forRoot({ checkpointer: { type: "memory" } }),
          LangGraphModule.forFeature([MessagedApprovalGraph]),
        ],
        providers: [CancelModel, CancelService, MessagedCancelTools],
      }).compile();
      app = moduleRef.createNestApplication();
      await app.init();
      graph = app.get(getGraphFacadeToken({ name: "messagedApproval" }));
      svc = app.get(CancelService);
    });

    afterAll(async () => {
      await app?.close();
    });

    beforeEach(() => {
      svc.cancelled.length = 0;
      approvalArgsSeen.length = 0;
    });

    it("carries the approvalMessage in the interrupt payload", async () => {
      const paused = (await graph.invoke(
        { messages: [new HumanMessage("cancel it")] },
        { configurable: { thread_id: "msg-pause" } },
      )) as Record<string, unknown>;

      const interrupts = paused.__interrupt__ as Array<{ value: unknown }>;
      expect(interrupts[0].value).toEqual({
        type: "tool_approval_request",
        tool: "cancel_order",
        args: { orderId: "7" },
        message: "Permanently cancel order 7? This cannot be undone.",
      });
    });

    it("hands the real tool-call args to the approvalMessage builder", async () => {
      await graph.invoke(
        { messages: [new HumanMessage("cancel it")] },
        { configurable: { thread_id: "msg-args" } },
      );
      expect(approvalArgsSeen).toEqual([{ orderId: "7" }]);
    });

    it("uses declineMessage on decline (provider path)", async () => {
      await graph.invoke(
        { messages: [new HumanMessage("cancel it")] },
        { configurable: { thread_id: "msg-decline" } },
      );
      const done = (await graph.resume("msg-decline", {
        approved: false,
        reason: "customer changed their mind",
      })) as { messages: BaseMessage[] };

      expect(svc.cancelled).toEqual([]);
      const toolMsgs = done.messages.filter((m) => m instanceof ToolMessage);
      expect(String(toolMsgs[0].content)).toBe(
        "Kept order 7 intact: customer changed their mind.",
      );
    });
  });

  describe("provider tool with a throwing approvalMessage", () => {
    let app: INestApplication;
    let graph: LangGraphRunnable<MsgState>;
    let warnSpy: jest.SpyInstance;

    beforeAll(async () => {
      const moduleRef = await Test.createTestingModule({
        imports: [
          LangGraphModule.forRoot({ checkpointer: { type: "memory" } }),
          LangGraphModule.forFeature([ThrowingApprovalGraph]),
        ],
        providers: [CancelModel, CancelService, ThrowingMsgCancelTools],
      }).compile();
      app = moduleRef.createNestApplication();
      await app.init();
      graph = app.get(getGraphFacadeToken({ name: "throwingApproval" }));
    });

    afterAll(async () => {
      await app?.close();
    });

    beforeEach(() => {
      warnSpy = jest.spyOn(Logger.prototype, "warn").mockImplementation();
    });

    afterEach(() => {
      warnSpy.mockRestore();
    });

    it("falls back to no message and warns, without corrupting the flow", async () => {
      const paused = (await graph.invoke(
        { messages: [new HumanMessage("cancel it")] },
        { configurable: { thread_id: "throw-pause" } },
      )) as Record<string, unknown>;

      const interrupts = paused.__interrupt__ as Array<{ value: unknown }>;
      // No `message` key — byte-identical to an unadorned approval request.
      expect(interrupts[0].value).toEqual({
        type: "tool_approval_request",
        tool: "cancel_order",
        args: { orderId: "7" },
      });
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining("approvalMessage for tool 'cancel_order' threw"),
      );

      // The flow still resumes normally.
      const svc = app.get(CancelService);
      svc.cancelled.length = 0;
      const done = (await graph.resume("throw-pause", { approved: true })) as {
        messages: BaseMessage[];
      };
      expect(svc.cancelled).toEqual(["7"]);
      expect(done.messages.some((m) => m instanceof ToolMessage)).toBe(true);
    });
  });

  describe("raw tool", () => {
    let app: INestApplication;
    let graph: LangGraphRunnable<MsgState>;

    beforeAll(async () => {
      const moduleRef = await Test.createTestingModule({
        imports: [
          LangGraphModule.forRoot({ checkpointer: { type: "memory" } }),
          LangGraphModule.forFeature([RawMessagedApprovalGraph]),
        ],
        providers: [WipeModel],
      }).compile();
      app = moduleRef.createNestApplication();
      await app.init();
      graph = app.get(getGraphFacadeToken({ name: "rawMessagedApproval" }));
    });

    afterAll(async () => {
      await app?.close();
    });

    beforeEach(() => {
      rawMsgRuns.length = 0;
    });

    it("carries the approvalMessage in the interrupt payload", async () => {
      const paused = (await graph.invoke(
        { messages: [new HumanMessage("wipe it")] },
        { configurable: { thread_id: "raw-msg-pause" } },
      )) as Record<string, unknown>;

      const interrupts = paused.__interrupt__ as Array<{ value: unknown }>;
      expect(interrupts[0].value).toEqual({
        type: "tool_approval_request",
        tool: "wipe",
        args: { target: "db" },
        message: "Really wipe db? This is irreversible.",
      });
    });

    it("uses declineMessage on decline (raw path)", async () => {
      await graph.invoke(
        { messages: [new HumanMessage("wipe it")] },
        { configurable: { thread_id: "raw-msg-decline" } },
      );
      const done = (await graph.resume("raw-msg-decline", {
        approved: false,
        reason: "not today",
      })) as { messages: BaseMessage[] };

      expect(rawMsgRuns).toEqual([]);
      const declineMsg = done.messages.find((m) => m instanceof ToolMessage)!;
      expect(String(declineMsg.content)).toBe("Left db untouched (not today).");
    });
  });

  describe("registration-time guard", () => {
    it("rejects a message option without requiresApproval, loudly", () => {
      expect(() =>
        LangGraphTool({
          name: "oops",
          description: "d",
          schema: z.object({ x: z.string() }),
          // Illegal: no requiresApproval. Cast past the compile-time union guard
          // to prove the runtime zod check also rejects it.
          approvalMessage: () => "hi",
        } as never),
      ).toThrow(/approvalMessage is only legal with requiresApproval: true/);
    });

    it("rejects a declineMessage option without requiresApproval, loudly", () => {
      expect(() =>
        LangGraphTool({
          name: "oops",
          description: "d",
          schema: z.object({ x: z.string() }),
          declineMessage: () => "bye",
        } as never),
      ).toThrow(/declineMessage is only legal with requiresApproval: true/);
    });
  });

  // Regression pin: a gated tool with NO custom wording behaves exactly as it did
  // in 0.1.3 — the interrupt payload has no `message` key at all.
  describe("absent options: byte-identical to the unadorned gate", () => {
    let app: INestApplication;
    let graph: LangGraphRunnable<MsgState>;

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
    });

    afterAll(async () => {
      await app?.close();
    });

    it("omits `message` from the interrupt payload", async () => {
      const paused = (await graph.invoke(
        { messages: [new HumanMessage("cancel it")] },
        { configurable: { thread_id: "no-msg" } },
      )) as Record<string, unknown>;

      const interrupts = paused.__interrupt__ as Array<{ value: unknown }>;
      const value = interrupts[0].value as Record<string, unknown>;
      expect(value).not.toHaveProperty("message");
      expect(value).toEqual({
        type: "tool_approval_request",
        tool: "cancel_order",
        args: { orderId: "7" },
      });
    });
  });
});
