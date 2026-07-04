import { Test } from "@nestjs/testing";
import type { INestApplication } from "@nestjs/common";

import {
  LangGraphModule,
  getGraphFacadeToken,
  type LangGraphRunnable,
} from "../index";
import { AskHumanNode, HilGraph, HilStateT } from "./fixtures";

/**
 * Real end-to-end integration test against the official SQLite checkpoint saver
 * using an in-process `:memory:` database — no live server required. Boots a
 * Nest app, drives the interrupt/resume flow, and asserts the thread's state
 * persists across two separate invoke calls (interrupt then resume).
 */
describe("Checkpointer: SQLite :memory: end-to-end", () => {
  let app: INestApplication;
  let hil: LangGraphRunnable<HilStateT>;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        LangGraphModule.forRoot({
          checkpointer: { type: "sqlite", path: ":memory:" },
        }),
        LangGraphModule.forFeature([HilGraph]),
      ],
      providers: [AskHumanNode],
    }).compile();
    app = moduleRef.createNestApplication();
    // Registers shutdown hooks so the module-owned sqlite db closes on close().
    app.enableShutdownHooks();
    await app.init();
    hil = app.get<LangGraphRunnable<HilStateT>>(
      getGraphFacadeToken({ name: "hil" }),
    );
  });

  afterAll(async () => {
    await app?.close();
  });

  it("persists a thread across interrupt and resume via SqliteSaver", async () => {
    const threadId = "sqlite-thread-1";
    const config = { configurable: { thread_id: threadId } };

    // First invoke pauses at interrupt() and checkpoints to sqlite.
    const paused = (await hil.invoke(
      { question: "What is your name?", answer: "" },
      config,
    )) as Record<string, unknown>;
    expect(paused.__interrupt__).toBeDefined();

    // The paused state was persisted: reading it back shows the pending run.
    const snapshotBefore = await hil.getState(config);
    expect((snapshotBefore.values as HilStateT).answer).toBe("");

    // Second invoke (resume) reloads the checkpoint from sqlite and completes.
    const done = await hil.resume(threadId, "Ada");
    expect(done.answer).toBe("Ada");

    // Final state is durably persisted on the same thread.
    const snapshotAfter = await hil.getState(config);
    expect((snapshotAfter.values as HilStateT).answer).toBe("Ada");
  });

  it("isolates state across different thread ids", async () => {
    const other = { configurable: { thread_id: "sqlite-thread-2" } };
    const paused = (await hil.invoke(
      { question: "Who are you?", answer: "" },
      other,
    )) as Record<string, unknown>;
    expect(paused.__interrupt__).toBeDefined();

    // Thread 1 remains completed and untouched by thread 2's fresh run.
    const t1 = await hil.getState({
      configurable: { thread_id: "sqlite-thread-1" },
    });
    expect((t1.values as HilStateT).answer).toBe("Ada");
  });
});
