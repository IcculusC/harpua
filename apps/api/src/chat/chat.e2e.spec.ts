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
