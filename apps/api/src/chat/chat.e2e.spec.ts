import type { Type } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { HumanMessage, isAIMessage } from "@langchain/core/messages";
import {
  createGraphTestingModule,
  ruleModel,
  scriptedModel,
  collectStream,
  expectInterrupt,
  textOf,
  type GraphTestingHarness,
  type ScriptedChatModel,
} from "@harpua/langgraph-testing";

import { AppModule } from "../app.module";
import { OrdersService } from "./orders.service";
import { OrderTools } from "./order.tools";
import { SystemPrompt } from "./system-prompt";
import { ChatService } from "./chat.service";
import {
  ApprovalNode,
  CallModelNode,
  ChatGraph,
  type ChatState,
} from "./chat.graph";
import { CHAT_MODEL } from "@harpua/models";

/* --------------------------------------------------------------------- *
 * Graph-level integration, via @harpua/langgraph-testing.
 *
 * Drives the real ChatGraph directly through the facade — no HTTP — with the
 * app's MockChatModel swapped (in tests only) for a helper model. This is the
 * simpler home for pure graph behaviour; the HTTP block below keeps the
 * controller/SSE-specific coverage.
 * --------------------------------------------------------------------- */
describe("Chat graph (integration)", () => {
  let harness: GraphTestingHarness;

  /** A rule model mirroring MockChatModel's behaviour, built with the helper. */
  function chatModel(): Type<ScriptedChatModel> {
    return ruleModel()
      .onToolResult((last) => `Here's what I found: ${textOf(last)}`)
      .onHuman(/\b(delete|cancel)\b/i, (text) => {
        const orderId = /order\s+#?([A-Za-z0-9-]+)/i.exec(text)?.[1] ?? null;
        return {
          text: orderId
            ? `Cancelling order ${orderId} is irreversible — I need your approval first.`
            : "That's a destructive action — I need your approval first.",
          additionalKwargs: {
            pending_action: { action: "cancel_order", orderId, request: text },
          },
        };
      })
      .onHuman(/order\s+#?([A-Za-z0-9-]+)/i, (_text, match) => ({
        toolCalls: [{ name: "lookup_order", args: { orderId: match[1] } }],
      }))
      .fallback(
        'Hi! I can check an order for you (try "check order 42") or cancel one with your approval.',
      )
      .build();
  }

  function bootChat(model: Type<ScriptedChatModel>): Promise<GraphTestingHarness> {
    return createGraphTestingModule({
      graphs: [ChatGraph],
      providers: [
        OrdersService,
        OrderTools,
        CallModelNode,
        ApprovalNode,
        SystemPrompt,
        { provide: CHAT_MODEL, useClass: model },
      ],
    });
  }

  function aiText(state: ChatState): string {
    return state.messages
      .filter((m) => isAIMessage(m))
      .map((m) => textOf(m))
      .filter((t) => t.length > 0)
      .join("\n");
  }

  afterEach(async () => {
    await harness?.close();
  });

  it("answers a plain turn with the canned reply", async () => {
    harness = await bootChat(chatModel());
    const chat = harness.get<ChatState>(ChatGraph);
    const result = await chat.invoke({
      messages: [new HumanMessage("hello there")],
    });
    expect(aiText(result)).toContain("check an order");
  });

  it("runs the lookup_order tool through DI and streams a 'tools' update", async () => {
    harness = await bootChat(chatModel());
    const chat = harness.get<ChatState>(ChatGraph);
    const orders = harness.app.get(OrdersService);

    const chunks = await collectStream(
      await chat.streamUpdates({
        messages: [new HumanMessage("what's the status of order 42?")],
      }),
    );

    const nodes = chunks.map((c) => Object.keys(c)[0]);
    expect(nodes).toContain("tools");
    expect(nodes).toContain("CallModelNode");
    // DI proof: the tool reached the in-memory OrdersService instance.
    expect(orders.lookups).toContain("42");
  });

  it("drives the same loop from a scripted sequence, zero rules", async () => {
    const scripted = scriptedModel()
      .toolCall("lookup_order", { orderId: "99" })
      .say("Your order is on its way.")
      .build();
    harness = await bootChat(scripted);
    const chat = harness.get<ChatState>(ChatGraph);
    const orders = harness.app.get(OrdersService);

    const result = await chat.invoke({
      messages: [new HumanMessage("track it")],
    });

    expect(orders.lookups).toContain("99");
    expect(aiText(result)).toContain("Your order is on its way.");
  });

  it("interrupts on a cancel request and completes on approval", async () => {
    harness = await bootChat(chatModel());
    const chat = harness.get<ChatState>(ChatGraph);
    const orders = harness.app.get(OrdersService);
    const cfg = { configurable: { thread_id: "cancel-approve" } };

    const paused = await chat.invoke(
      { messages: [new HumanMessage("please cancel order 7")] },
      cfg,
    );
    const pending = expectInterrupt<{
      type: string;
      action: string;
      orderId: string;
    }>(paused);
    expect(pending).toEqual(
      expect.objectContaining({
        type: "approval_request",
        action: "cancel_order",
        orderId: "7",
      }),
    );
    expect(orders.statusOf("7")).toBe("shipped");

    const resumed = await chat.resume("cancel-approve", { approved: true });
    expect(aiText(resumed)).toContain("Order 7 has been cancelled");
    expect(orders.statusOf("7")).toBe("cancelled");
  });

  it("declines the pending action when resume is not approved", async () => {
    harness = await bootChat(chatModel());
    const chat = harness.get<ChatState>(ChatGraph);
    const orders = harness.app.get(OrdersService);
    const cfg = { configurable: { thread_id: "cancel-decline" } };

    const paused = await chat.invoke(
      { messages: [new HumanMessage("delete order 9")] },
      cfg,
    );
    expect(expectInterrupt(paused)).toBeDefined();

    const resumed = await chat.resume("cancel-decline", { approved: false });
    expect(aiText(resumed)).toContain("not made any changes");
    expect(orders.statusOf("9")).toBe("shipped");
  });
});

/* --------------------------------------------------------------------- *
 * HTTP end-to-end — controller wiring + SSE framing over the real app.
 * --------------------------------------------------------------------- */
describe("Chat over HTTP (e2e)", () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
  });

  it("keeps the existing hello endpoint working", async () => {
    const res = await request(app.getHttpServer()).get("/").expect(200);
    expect(res.text).toBe("Hello from Harpua API!");
  });

  it("answers a plain chat turn over HTTP", async () => {
    const res = await request(app.getHttpServer())
      .post("/chat/plain-1")
      .send({ message: "hello there" })
      .expect(201);
    expect(res.body.messages).toHaveLength(1);
    expect(res.body.messages[0]).toContain("check an order");
    expect(res.body.interrupt).toBeUndefined();
  });

  it("interrupts on a cancel request and completes on approval over HTTP", async () => {
    const paused = await request(app.getHttpServer())
      .post("/chat/cancel-approve")
      .send({ message: "please cancel order 7" })
      .expect(201);
    expect(paused.body.interrupt).toEqual(
      expect.objectContaining({
        type: "approval_request",
        action: "cancel_order",
        orderId: "7",
      }),
    );

    const resumed = await request(app.getHttpServer())
      .post("/chat/cancel-approve/resume")
      .send({ approved: true })
      .expect(201);
    expect(resumed.body.interrupt).toBeUndefined();
    expect(resumed.body.messages.join("\n")).toContain(
      "Order 7 has been cancelled",
    );
  });

  // --- SSE streaming endpoint -------------------------------------------

  /** Parses a raw text/event-stream body into [{ event, data }] frames. */
  function parseSse(body: string): Array<{ event: string; data: unknown }> {
    return body
      .split("\n\n")
      .map((f) => f.trim())
      .filter((f) => f.length > 0)
      .map((frame) => {
        const lines = frame.split("\n");
        const event =
          lines.find((l) => l.startsWith("event:"))?.slice(6).trim() ??
          "message";
        const dataLine =
          lines.find((l) => l.startsWith("data:"))?.slice(5).trim() ?? "";
        let data: unknown = dataLine;
        try {
          data = JSON.parse(dataLine);
        } catch {
          /* leave as string */
        }
        return { event, data };
      });
  }

  it("streams a plain turn as SSE: a node update then a final event", async () => {
    const res = await request(app.getHttpServer())
      .get("/chat/sse-plain/stream")
      .query({ message: "hello there" })
      .buffer(true)
      .parse((r, cb) => {
        let body = "";
        r.on("data", (c: Buffer) => (body += c.toString()));
        r.on("end", () => cb(null, body));
      })
      .expect(200);

    const frames = parseSse(res.body as string);
    const events = frames.map((f) => f.event);
    expect(events).toContain("CallModelNode");
    expect(events[events.length - 1]).toBe("final");

    const final = frames.at(-1)!.data as {
      messages: string[];
      interrupt?: unknown;
    };
    expect(final.interrupt).toBeUndefined();
    expect(final.messages.join("\n")).toContain("check an order");
  });

  it("streams an order lookup, surfacing a 'tools' node update", async () => {
    const res = await request(app.getHttpServer())
      .get("/chat/sse-orders/stream")
      .query({ message: "what's the status of order 42?" })
      .buffer(true)
      .parse((r, cb) => {
        let body = "";
        r.on("data", (c: Buffer) => (body += c.toString()));
        r.on("end", () => cb(null, body));
      })
      .expect(200);

    const frames = parseSse(res.body as string);
    const events = frames.map((f) => f.event);
    expect(events).toContain("tools");
    expect(events[events.length - 1]).toBe("final");

    const final = frames.at(-1)!.data as { messages: string[] };
    expect(final.messages.join("\n")).toContain("Order 42");
  });

  it("streams a cancel turn: terminal event carries the interrupt payload", async () => {
    const res = await request(app.getHttpServer())
      .get("/chat/sse-cancel/stream")
      .query({ message: "please cancel order 7" })
      .buffer(true)
      .parse((r, cb) => {
        let body = "";
        r.on("data", (c: Buffer) => (body += c.toString()));
        r.on("end", () => cb(null, body));
      })
      .expect(200);

    const frames = parseSse(res.body as string);
    const final = frames.at(-1)!;
    expect(final.event).toBe("final");
    const payload = final.data as { interrupt?: Record<string, unknown> };
    expect(payload.interrupt).toEqual(
      expect.objectContaining({
        type: "approval_request",
        action: "cancel_order",
        orderId: "7",
      }),
    );

    const resumed = await request(app.getHttpServer())
      .post("/chat/sse-cancel/resume")
      .send({ approved: true })
      .expect(201);
    expect(resumed.body.messages.join("\n")).toContain(
      "Order 7 has been cancelled",
    );
  });

  it("persists history across turns on the same thread", async () => {
    const server = app.getHttpServer();
    await request(server)
      .post("/chat/persist-1")
      .send({ message: "hi" })
      .expect(201);
    await request(server)
      .post("/chat/persist-1")
      .send({ message: "check order 11" })
      .expect(201);

    const history = await app.get(ChatService).history("persist-1");
    // Turn 1: human + assistant. Turn 2: human + tool-call AI + tool + summary.
    expect(history.length).toBe(6);
    const texts = history.map((m) =>
      typeof m.content === "string" ? m.content : JSON.stringify(m.content),
    );
    expect(texts[0]).toBe("hi");
    expect(texts[2]).toBe("check order 11");
    expect(texts.join("\n")).toContain("Order 11");
  });
});
