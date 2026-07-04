import { Test } from "@nestjs/testing";
import type { INestApplication } from "@nestjs/common";
import request from "supertest";

import { AppModule } from "../app.module";
import { OrdersService } from "./orders.service";
import { ChatService } from "./chat.service";

describe("Chat (e2e)", () => {
  let app: INestApplication;
  let orders: OrdersService;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    orders = app.get(OrdersService);
  });

  afterAll(async () => {
    await app?.close();
  });

  it("keeps the existing hello endpoint working", async () => {
    const res = await request(app.getHttpServer()).get("/").expect(200);
    expect(res.text).toBe("Hello from Harpua API!");
  });

  it("answers a plain chat turn with the canned reply", async () => {
    const res = await request(app.getHttpServer())
      .post("/chat/plain-1")
      .send({ message: "hello there" })
      .expect(201);
    expect(res.body.messages).toHaveLength(1);
    expect(res.body.messages[0]).toContain("check an order");
    expect(res.body.interrupt).toBeUndefined();
  });

  it("runs the lookup_order tool through DI for an order mention", async () => {
    const res = await request(app.getHttpServer())
      .post("/chat/orders-1")
      .send({ message: "what's the status of order 42?" })
      .expect(201);
    expect(res.body.interrupt).toBeUndefined();
    const reply = res.body.messages.join("\n");
    expect(reply).toContain("Order 42");
    expect(reply).toContain("shipped");
    // DI proof: the tool reached the in-memory OrdersService instance.
    expect(orders.lookups).toContain("42");
  });

  it("interrupts on a cancel request and completes on approval", async () => {
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
    expect(paused.body.messages.join("\n")).toContain("approval");
    expect(orders.statusOf("7")).toBe("shipped");

    const resumed = await request(app.getHttpServer())
      .post("/chat/cancel-approve/resume")
      .send({ approved: true })
      .expect(201);
    expect(resumed.body.interrupt).toBeUndefined();
    expect(resumed.body.messages.join("\n")).toContain(
      "Order 7 has been cancelled",
    );
    expect(orders.statusOf("7")).toBe("cancelled");
  });

  it("declines the pending action when resume is not approved", async () => {
    const paused = await request(app.getHttpServer())
      .post("/chat/cancel-decline")
      .send({ message: "delete order 9" })
      .expect(201);
    expect(paused.body.interrupt).toBeDefined();

    const resumed = await request(app.getHttpServer())
      .post("/chat/cancel-decline/resume")
      .send({ approved: false })
      .expect(201);
    expect(resumed.body.interrupt).toBeUndefined();
    expect(resumed.body.messages.join("\n")).toContain(
      "not made any changes",
    );
    expect(orders.statusOf("9")).toBe("shipped");
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
    // At least one node-update event, then the terminal final event.
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

    // The paused thread can be resumed via the existing POST endpoint.
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
