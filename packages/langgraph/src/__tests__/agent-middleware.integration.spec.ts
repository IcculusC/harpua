import { Test } from "@nestjs/testing";
import type { INestApplication } from "@nestjs/common";
import { z } from "zod";
import { StateSchema, MessagesValue } from "@langchain/langgraph";
import { AIMessage, HumanMessage, isAIMessage } from "@langchain/core/messages";
import {
  BaseChatModel,
  type BindToolsInput,
} from "@langchain/core/language_models/chat_models";
import type { ChatResult } from "@langchain/core/outputs";

import { LangGraphModule, getGraphFacadeToken } from "../index";
import type { LangGraphRunnable } from "../index";
import { LangGraphAgent } from "../agent/agent.decorator";
import { BudgetMiddleware, provideBudget } from "../middleware/budget.middleware";
import { RetryMiddleware, provideRetry } from "../middleware/retry.middleware";
import { OrderService, OrderTools } from "./fixtures";

/**
 * End-to-end proof that Budget + Retry actually drive a booted
 * `@LangGraphAgent`'s runtime graph — not just their unit-level hook/wrap
 * contracts. Local scripted `BaseChatModel`s (same pattern as
 * `agent-boot.spec.ts`), not `@harpua/langgraph-testing`: that package
 * peer-depends on this one, so a devDependency the other way round would be a
 * circular workspace/build-graph edge turbo rejects outright.
 *
 * GOTCHA: `BaseChatModel` retries a throwing `_generate` internally (default
 * `maxRetries: 6`) *before* the error ever reaches `RetryMiddleware`, which
 * would silently mask the middleware under test behind langchain's own retry.
 * Every local model below is constructed with `super({ maxRetries: 0 })` so
 * `RetryMiddleware` is the only thing retrying, and each test asserts exact
 * `_generate` call counts to prove that.
 */

const BUDGET_CHAT_MODEL = Symbol.for("agent-middleware-integration:BUDGET_CHAT_MODEL");
const RETRY_CHAT_MODEL = Symbol.for("agent-middleware-integration:RETRY_CHAT_MODEL");
const ORDERING_CHAT_MODEL = Symbol.for(
  "agent-middleware-integration:ORDERING_CHAT_MODEL",
);

const AgentMessagesState = new StateSchema({ messages: MessagesValue });

/* ------------------------------------------------------------------ *
 * Test 1: Budget stops the loop -> typed outcome
 * ------------------------------------------------------------------ */

/**
 * Always emits a `lookup_order` tool call from `_generate` — left to its own
 * devices this loop never ends — and overrides `withStructuredOutput` so the
 * `StructuredResponseNode` Budget's exit routes to can coerce a final answer
 * without a real model.
 */
class AlwaysToolBudgetModel extends BaseChatModel {
  generateCalls = 0;

  constructor() {
    super({ maxRetries: 0 });
  }

  _llmType(): string {
    return "budget-always-tool";
  }

  bindTools(_tools: BindToolsInput[]): this {
    return this;
  }

  async _generate(): Promise<ChatResult> {
    this.generateCalls += 1;
    const message = new AIMessage({
      content: "",
      tool_calls: [
        {
          name: "lookup_order",
          args: { id: String(this.generateCalls) },
          id: `call_${this.generateCalls}`,
          type: "tool_call",
        },
      ],
    });
    return { generations: [{ message, text: "" }] };
  }

  withStructuredOutput(_schema: unknown): any {
    return {
      invoke: async () => ({ status: "escalate", reason: "budget" }),
    };
  }
}

const BudgetResponseFormat = z.object({ status: z.string(), reason: z.string() });

@LangGraphAgent({
  name: "budgetAgent",
  state: AgentMessagesState,
  model: BUDGET_CHAT_MODEL,
  tools: [OrderTools],
  middleware: [BudgetMiddleware],
  responseFormat: BudgetResponseFormat,
})
class BudgetAgent {}

/* ------------------------------------------------------------------ *
 * Test 2: Retry re-invokes the model
 * ------------------------------------------------------------------ */

/** Throws once from `_generate`, then answers plainly (no tool call). */
class ThrowOnceModel extends BaseChatModel {
  generateCalls = 0;

  constructor() {
    super({ maxRetries: 0 });
  }

  _llmType(): string {
    return "throw-once-model";
  }

  bindTools(_tools: BindToolsInput[]): this {
    return this;
  }

  async _generate(): Promise<ChatResult> {
    this.generateCalls += 1;
    if (this.generateCalls === 1) {
      throw new Error("transient upstream failure");
    }
    const message = new AIMessage("done");
    return { generations: [{ message, text: "done" }] };
  }
}

@LangGraphAgent({
  name: "retryAgent",
  state: AgentMessagesState,
  model: RETRY_CHAT_MODEL,
  middleware: [RetryMiddleware],
})
class RetryAgent {}

/* ------------------------------------------------------------------ *
 * Test 3: Ordering — Budget gates the model call each turn
 * ------------------------------------------------------------------ */

/** Same always-tool shape as `AlwaysToolBudgetModel`, no structured output needed. */
class AlwaysToolOrderingModel extends BaseChatModel {
  generateCalls = 0;

  constructor() {
    super({ maxRetries: 0 });
  }

  _llmType(): string {
    return "ordering-always-tool";
  }

  bindTools(_tools: BindToolsInput[]): this {
    return this;
  }

  async _generate(): Promise<ChatResult> {
    this.generateCalls += 1;
    const message = new AIMessage({
      content: "",
      tool_calls: [
        {
          name: "lookup_order",
          args: { id: String(this.generateCalls) },
          id: `call_${this.generateCalls}`,
          type: "tool_call",
        },
      ],
    });
    return { generations: [{ message, text: "" }] };
  }
}

@LangGraphAgent({
  name: "orderingAgent",
  state: AgentMessagesState,
  model: ORDERING_CHAT_MODEL,
  tools: [OrderTools],
  middleware: [BudgetMiddleware, RetryMiddleware],
})
class OrderingAgent {}

/* ------------------------------------------------------------------ */

describe("Budget + Retry driving a booted @LangGraphAgent (integration)", () => {
  let app: INestApplication;

  afterEach(async () => {
    await app?.close();
  });

  it("Budget's beforeModel exit routes through StructuredResponseNode into the outcome channel, stopping a runaway tool loop", async () => {
    const model = new AlwaysToolBudgetModel();
    const moduleRef = await Test.createTestingModule({
      imports: [
        LangGraphModule.forRoot(),
        // provideBudget()'s BUDGET_OPTS provider must live in the SAME
        // DynamicModule as the BudgetMiddleware class agentProviders()
        // auto-registers here (see forFeature's doc comment) -- a sibling
        // registration at the app-root `providers:` level below is a
        // DIFFERENT, non-importing module scope and can't be seen by it.
        LangGraphModule.forFeature([BudgetAgent], {
          providers: [
            ...provideBudget({
              maxCycles: 2,
              maxToolCalls: 999,
              maxTokens: 999999,
              maxWallMs: 999999,
            }),
          ],
        }),
      ],
      providers: [
        OrderService,
        OrderTools,
        { provide: BUDGET_CHAT_MODEL, useValue: model },
      ],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();

    const agent = app.get<LangGraphRunnable>(
      getGraphFacadeToken({ name: "budgetAgent" }),
    );
    const res: any = await agent.invoke({
      messages: [new HumanMessage("keep looking up my order")],
    });

    // The model never stops requesting tools on its own -- if Budget's exit
    // hadn't short-circuited the loop, this would run away to the graph's
    // hard recursionLimit instead of stopping at the soft cap.
    expect(model.generateCalls).toBe(2);
    expect(res.loop.iteration).toBeLessThanOrEqual(2);
    expect(res.outcome).toEqual({ status: "escalate", reason: "budget" });
  });

  it("RetryMiddleware re-invokes the model through the graph after a thrown model call", async () => {
    const model = new ThrowOnceModel();
    const moduleRef = await Test.createTestingModule({
      imports: [
        LangGraphModule.forRoot(),
        LangGraphModule.forFeature([RetryAgent], {
          providers: [
            ...provideRetry({
              maxRetries: 1,
              retryable: () => true,
              backoff: async () => {},
            }),
          ],
        }),
      ],
      providers: [{ provide: RETRY_CHAT_MODEL, useValue: model }],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();

    const agent = app.get<LangGraphRunnable>(
      getGraphFacadeToken({ name: "retryAgent" }),
    );
    const res: any = await agent.invoke({
      messages: [new HumanMessage("hello")],
    });

    // langchain's own retry is disabled (maxRetries: 0 on the model), so these
    // two calls can only be RetryMiddleware's wrapModelCall re-invoking `next`.
    expect(model.generateCalls).toBe(2);
    const last = res.messages[res.messages.length - 1];
    expect(isAIMessage(last)).toBe(true);
    expect(String(last.content)).toBe("done");
  });

  it("Budget's beforeModel gates the model call each turn (runs before CallModel)", async () => {
    const model = new AlwaysToolOrderingModel();
    const moduleRef = await Test.createTestingModule({
      imports: [
        LangGraphModule.forRoot(),
        LangGraphModule.forFeature([OrderingAgent], {
          providers: [
            ...provideBudget({
              maxCycles: 1,
              maxToolCalls: 999,
              maxTokens: 999999,
              maxWallMs: 999999,
            }),
            ...provideRetry({
              maxRetries: 1,
              retryable: () => true,
              backoff: async () => {},
            }),
          ],
        }),
      ],
      providers: [
        OrderService,
        OrderTools,
        { provide: ORDERING_CHAT_MODEL, useValue: model },
      ],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();

    const agent = app.get<LangGraphRunnable>(
      getGraphFacadeToken({ name: "orderingAgent" }),
    );
    const res: any = await agent.invoke({
      messages: [new HumanMessage("keep looking up my order")],
    });

    // maxCycles: 1 means beforeModel only clears on the FIRST turn (iteration
    // 0 < 1); once CallModel bumps iteration to 1 and the always-tool model's
    // reply routes back through TOOLS, beforeModel sees iteration 1 >= 1 and
    // exits BEFORE a second CallModel would ever run. If Budget's node ran
    // after CallModel instead of before it, this would observe 2 calls.
    expect(model.generateCalls).toBe(1);
    expect(res.loop.iteration).toBeLessThanOrEqual(1);
  });
});
