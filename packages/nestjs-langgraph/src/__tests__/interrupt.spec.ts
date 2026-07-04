import { Test } from "@nestjs/testing";
import type { INestApplication } from "@nestjs/common";

import {
  LangGraphModule,
  getGraphFacadeToken,
  type LangGraphRunnable,
} from "../index";
import { AskHumanNode, HilGraph, HilStateT } from "./fixtures";

describe("LangGraph dynamic interrupt / resume with MemorySaver", () => {
  let app: INestApplication;
  let hil: LangGraphRunnable<HilStateT>;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        // Default checkpointer is MemorySaver.
        LangGraphModule.forRoot({ checkpointer: { type: "memory" } }),
        LangGraphModule.forFeature([HilGraph]),
      ],
      providers: [AskHumanNode],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    hil = app.get<LangGraphRunnable<HilStateT>>(
      getGraphFacadeToken({ name: "hil" }),
    );
  });

  afterAll(async () => {
    await app?.close();
  });

  it("pauses at interrupt() then completes after resume()", async () => {
    const threadId = "thread-hil-1";
    const config = { configurable: { thread_id: threadId } };

    const paused = (await hil.invoke(
      { question: "What is your name?", answer: "" },
      config,
    )) as Record<string, unknown>;

    // The interrupt surfaced instead of finishing.
    expect(paused.__interrupt__).toBeDefined();
    const interrupts = paused.__interrupt__ as Array<{ value: unknown }>;
    expect(interrupts[0].value).toBe("What is your name?");
    expect(paused.answer).toBe("");

    // Resume with the human's value.
    const done = await hil.resume(threadId, "Ada");
    expect(done.answer).toBe("Ada");
  });
});
