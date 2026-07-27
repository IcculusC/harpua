import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { StateSchema, MessagesValue } from "@langchain/langgraph";
import { AIMessage, HumanMessage, ToolMessage } from "@langchain/core/messages";
import {
  BaseChatModel,
  type BindToolsInput,
} from "@langchain/core/language_models/chat_models";
import type { ChatResult } from "@langchain/core/outputs";
import { z } from "zod";

import { LangGraphModule, getGraphFacadeToken, lazyModel } from "../index";
import type { LangGraphRunnable } from "../index";
import { LangGraphAgent } from "../agent/agent.decorator";
import { OrderService, OrderTools } from "./fixtures";

const FAST = Symbol.for("lazy-agent:ChatModel:fast");
const MISSING = Symbol.for("lazy-agent:ChatModel:missing");
const CODER = Symbol.for("lazy-agent:ChatModel:coercing");

const outcomeSchema = z.object({ status: z.string() });

class ScriptedModel extends BaseChatModel {
  private turn = 0;
  constructor() {
    super({});
  }
  _llmType(): string {
    return "lazy-agent-scripted";
  }
  bindTools(_tools: BindToolsInput[]): this {
    return this;
  }
  async _generate(): Promise<ChatResult> {
    this.turn += 1;
    const message =
      this.turn === 1
        ? new AIMessage({
            content: "",
            tool_calls: [
              { name: "lookup_order", args: { id: "42" }, id: "call_1", type: "tool_call" },
            ],
          })
        : new AIMessage("shipped");
    return { generations: [{ message, text: String(message.content) }] };
  }
}

@LangGraphAgent({
  name: "lazySupport",
  state: new StateSchema({ messages: MessagesValue }),
  model: lazyModel(FAST),
  tools: [OrderTools],
})
class LazySupportAgent {}

@LangGraphAgent({
  name: "lazyMissing",
  state: new StateSchema({ messages: MessagesValue }),
  model: lazyModel(MISSING),
})
class LazyMissingAgent {}

// A withStructuredOutput-capable model: the structured-response node resolves
// its model via moduleRef.get at CALL time, so a lazyModel must be unwrapped to
// its underlying token there (it is not a resolvable DI token itself).
class CoercingModel extends BaseChatModel {
  constructor() {
    super({});
  }
  _llmType(): string {
    return "lazy-agent-coercing";
  }
  bindTools(_tools: BindToolsInput[]): this {
    return this;
  }
  withStructuredOutput(): any {
    return { invoke: async () => ({ status: "coerced" }) };
  }
  async _generate(): Promise<ChatResult> {
    return { generations: [{ message: new AIMessage("done"), text: "done" }] };
  }
}

@LangGraphAgent({
  name: "lazyStructured",
  state: new StateSchema({ messages: MessagesValue }),
  model: lazyModel(CODER),
  responseFormat: outcomeSchema,
})
class LazyStructuredAgent {}

describe("@LangGraphAgent with lazyModel", () => {
  let app: INestApplication;
  afterEach(async () => {
    await app?.close();
  });

  it("boots and runs when the lazy arm is present", async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [LangGraphModule.forRoot(), LangGraphModule.forFeature([LazySupportAgent])],
      providers: [OrderTools, OrderService, { provide: FAST, useClass: ScriptedModel }],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    const agent = app.get<LangGraphRunnable>(getGraphFacadeToken({ name: "lazySupport" }));
    const res: any = await agent.invoke({ messages: [new HumanMessage("look up order 42")] });
    expect(res.messages.some((m: any) => m instanceof ToolMessage)).toBe(true);
  });

  it("boots WITHOUT the lazy arm registered (the boot-crash-killer)", async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [LangGraphModule.forRoot(), LangGraphModule.forFeature([LazyMissingAgent])],
    }).compile();
    app = moduleRef.createNestApplication();
    // An eager `model: MISSING` would throw during init; lazy must boot clean.
    await expect(app.init()).resolves.toBeDefined();
  });

  it("resolves a lazy arm through the structured-response node (responseFormat)", async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [LangGraphModule.forRoot(), LangGraphModule.forFeature([LazyStructuredAgent])],
      providers: [{ provide: CODER, useClass: CoercingModel }],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    const agent = app.get<LangGraphRunnable>(getGraphFacadeToken({ name: "lazyStructured" }));
    const res: any = await agent.invoke({ messages: [new HumanMessage("go")] });
    // Proves agent-compiler unwraps lazyModel -> token for the structured node,
    // which resolves it at call time and coerces via withStructuredOutput.
    expect(res.outcome).toEqual({ status: "coerced" });
  });
});
