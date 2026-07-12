import { Test } from "@nestjs/testing";
import type { INestApplication } from "@nestjs/common";
import { StateSchema, MessagesValue, Command, interrupt } from "@langchain/langgraph";
import { AIMessage, HumanMessage, isToolMessage } from "@langchain/core/messages";
import {
  BaseChatModel,
  type BindToolsInput,
} from "@langchain/core/language_models/chat_models";
import type { ChatResult } from "@langchain/core/outputs";
import { tool } from "@langchain/core/tools";
import { z } from "zod";

import { LangGraphModule, getGraphFacadeToken } from "../index";
import type { LangGraphRunnable } from "../index";
import { LangGraphAgent } from "../agent/agent.decorator";
import { LangGraphMiddleware } from "../middleware/middleware.decorator";
import { BudgetMiddleware, provideBudget } from "../middleware/budget.middleware";

/**
 * Regression suite for the persisted-exit brick (public issue #54): a budget
 * exit persisted on a thread must not short-circuit the NEXT invoke's
 * beforeAgent chain before Budget's per-invoke reset can run — regardless of
 * where Budget sits in the middleware array. Also pins the current
 * `maxWallMs` semantics around `interrupt()` suspension.
 */

const CHAT_MODEL = Symbol.for("exit-recovery:CHAT_MODEL");
const AgentState = new StateSchema({ messages: MessagesValue });

/** Calls the exec tool once per human turn, then answers after the result. */
class OneToolThenDoneModel extends BaseChatModel {
  generateCalls = 0;
  constructor() {
    super({ maxRetries: 0 });
  }
  _llmType(): string {
    return "one-tool-then-done";
  }
  bindTools(_tools: BindToolsInput[]): this {
    return this;
  }
  async _generate(messages: any[]): Promise<ChatResult> {
    this.generateCalls += 1;
    const last = messages[messages.length - 1];
    const message = isToolMessage(last)
      ? new AIMessage("done")
      : new AIMessage({
          content: "",
          tool_calls: [
            {
              name: "dangerous_exec",
              // The human text names the command, so a test can drive the
              // tool into its slow (active-overrun) or gated (interrupt) path.
              args: { cmd: String(last?.content ?? "").replace(/^run /, "") },
              id: `call_${this.generateCalls}`,
              type: "tool_call",
            },
          ],
        });
    return { generations: [{ message, text: "" }] };
  }
}

const dangerousExec = tool(
  async ({ cmd }) => {
    if (cmd === "slow") {
      // An ACTIVE overrun: the tool genuinely burns wall time, no human involved.
      await sleep(WALL_MS * 2);
      return "ran slow";
    }
    const approved = interrupt(`approve: ${cmd}?`);
    return approved === "y" ? `ran ${cmd}` : "declined";
  },
  {
    name: "dangerous_exec",
    description: "Run a shell command after human approval.",
    schema: z.object({ cmd: z.string() }),
  },
);

/** An innocuous beforeAgent middleware listed BEFORE Budget — the trigger shape. */
@LangGraphMiddleware()
class NoopConventionsMiddleware {
  beforeAgent(): void {}
}

// Generous margin: the agent preset has no injectable clock (hook nodes fall
// back to Date.now), so this suite is real-time — the wall must be wide
// enough that scheduling under a parallel full-suite run can't trip it
// incidentally, while the deliberate sleeps still overshoot it 2x.
const WALL_MS = 400;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

@LangGraphAgent({
  name: "recovery",
  state: AgentState,
  model: CHAT_MODEL,
  tools: [dangerousExec],
  middleware: [NoopConventionsMiddleware, BudgetMiddleware],
})
class RecoveryAgent {}

describe("persisted budget exit vs the next invoke", () => {
  let app: INestApplication;
  let agent: LangGraphRunnable<any>;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        LangGraphModule.forRoot({ checkpointer: { type: "memory" } }),
        LangGraphModule.forFeature([RecoveryAgent], {
          providers: [
            ...provideBudget({
              maxCycles: 10,
              maxToolCalls: 10,
              maxTokens: 1_000_000,
              maxWallMs: WALL_MS,
              reset: "invoke",
            }),
            { provide: CHAT_MODEL, useClass: OneToolThenDoneModel },
          ],
        }),
      ],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    agent = app.get(getGraphFacadeToken({ name: "recovery" }));
  });

  afterAll(async () => {
    await app?.close();
  });

  it("an ACTIVE tool overrun (no human involved) still walls the turn", async () => {
    const config = { configurable: { thread_id: "t-wall" } };

    const walled = (await agent.invoke(
      { messages: [new HumanMessage("run slow")] },
      config,
    )) as any;
    expect(walled.exit?.requested).toBe(true);
    expect(walled.exit?.meta?.reason).toBe("budget:wall");
  });

  it("the walled thread RECOVERS on the next fresh turn even with a beforeAgent middleware ordered before Budget", async () => {
    const config = { configurable: { thread_id: "t-wall" } };

    const before = (await agent.getState(config)) as any;
    const staleStartedAt = before.values?.loop?.startedAt;

    // Two genuinely fresh turns — with the brick, both re-exit budget:wall
    // instantly with loop.startedAt frozen at the stale anchor.
    for (const text of ["hello?", "continue"]) {
      const next = (await agent.invoke(
        { messages: [new HumanMessage(text)] },
        config,
      )) as any;
      expect(next.exit?.meta?.reason).not.toBe("budget:wall");
      expect(next.loop?.startedAt).not.toBe(staleStartedAt);
      // The turn did real work: it reached the model and paused at the
      // tool's approval interrupt instead of exiting at the door.
      expect(next.__interrupt__).toBeDefined();
      // Drain the pending approval so the next iteration starts fresh. No
      // assertion: under a loaded suite this resume can legitimately trip
      // the real-time wall — and the regression under test is precisely
      // that the NEXT fresh turn recovers from a walled turn.
      await agent.invoke(new Command({ resume: "y" }), config);
    }
  });

  it("an abandoned interrupt does not poison the following fresh turns", async () => {
    const config = { configurable: { thread_id: "t-abandoned" } };

    const paused = (await agent.invoke(
      { messages: [new HumanMessage("run ls")] },
      config,
    )) as any;
    expect(paused.__interrupt__).toBeDefined();

    await sleep(WALL_MS * 2); // human walks away, never approves

    const next = (await agent.invoke(
      { messages: [new HumanMessage("nevermind, hello?")] },
      config,
    )) as any;
    expect(next.exit?.meta?.reason).not.toBe("budget:wall");
    expect(next.__interrupt__).toBeDefined();
  });
});
