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
import { BudgetMiddleware, provideBudget } from "../middleware/budget.middleware";

/**
 * `maxWallMs` guards UNATTENDED runaway, not human deliberation: time a run
 * spends suspended at an `interrupt()` is credited back to the wall when the
 * facade resumes it (report 005's design half). An ACTIVE overrun — a tool
 * that genuinely burns wall time — must still trip the cap.
 */

const CHAT_MODEL = Symbol.for("wall-credit:CHAT_MODEL");
const AgentState = new StateSchema({ messages: MessagesValue });

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
              name: "gated_exec",
              args: { cmd: "ls" },
              id: `call_${this.generateCalls}`,
              type: "tool_call",
            },
          ],
        });
    return { generations: [{ message, text: "" }] };
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const WALL_MS = 400;

const gatedExec = tool(
  async ({ cmd }) => {
    const approved = interrupt(`approve: ${cmd}?`);
    return approved === "y" ? `ran ${cmd}` : "declined";
  },
  {
    name: "gated_exec",
    description: "Run a command after human approval.",
    schema: z.object({ cmd: z.string() }),
  },
);

@LangGraphAgent({
  name: "wallCredit",
  state: AgentState,
  model: CHAT_MODEL,
  tools: [gatedExec],
  middleware: [BudgetMiddleware],
})
class WallCreditAgent {}

describe("interrupt suspension is credited against maxWallMs", () => {
  let app: INestApplication;
  let agent: LangGraphRunnable<any>;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        LangGraphModule.forRoot({ checkpointer: { type: "memory" } }),
        LangGraphModule.forFeature([WallCreditAgent], {
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
    agent = app.get(getGraphFacadeToken({ name: "wallCredit" }));
  });

  afterAll(async () => {
    await app?.close();
  });

  it("a human deliberating past the wall does NOT wall the resumed turn", async () => {
    const config = { configurable: { thread_id: "t-credit" } };

    const paused = (await agent.invoke(
      { messages: [new HumanMessage("run ls")] },
      config,
    )) as any;
    expect(paused.__interrupt__).toBeDefined();

    await sleep(WALL_MS * 2); // human thinks it over, well past the wall

    const resumed = (await agent.invoke(new Command({ resume: "y" }), config)) as any;
    expect(resumed.exit?.meta?.reason).not.toBe("budget:wall");
    // The turn actually finished: the model processed the tool result.
    expect(String(resumed.messages?.at(-1)?.content)).toBe("done");
  });

  it("TWO slow approvals in one thread are both credited", async () => {
    const config = { configurable: { thread_id: "t-credit-2" } };

    const paused = (await agent.invoke(
      { messages: [new HumanMessage("run ls")] },
      config,
    )) as any;
    expect(paused.__interrupt__).toBeDefined();
    await sleep(WALL_MS * 2);
    const done1 = (await agent.invoke(new Command({ resume: "y" }), config)) as any;
    expect(done1.exit?.meta?.reason).not.toBe("budget:wall");

    const paused2 = (await agent.invoke(
      { messages: [new HumanMessage("run ls again")] },
      config,
    )) as any;
    expect(paused2.__interrupt__).toBeDefined();
    await sleep(WALL_MS * 2);
    const done2 = (await agent.invoke(new Command({ resume: "y" }), config)) as any;
    expect(done2.exit?.meta?.reason).not.toBe("budget:wall");
    expect(String(done2.messages?.at(-1)?.content)).toBe("done");
  });

  it("resuming via the facade's resume() helper is credited too", async () => {
    const config = { configurable: { thread_id: "t-credit-3" } };
    const paused = (await agent.invoke(
      { messages: [new HumanMessage("run ls")] },
      config,
    )) as any;
    expect(paused.__interrupt__).toBeDefined();
    await sleep(WALL_MS * 2);
    const resumed = (await agent.resume("t-credit-3", "y")) as any;
    expect(resumed.exit?.meta?.reason).not.toBe("budget:wall");
  });
});
