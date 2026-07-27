import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { StateSchema, MessagesValue } from "@langchain/langgraph";
import { AIMessage, HumanMessage, ToolMessage } from "@langchain/core/messages";
import {
  BaseChatModel,
  type BindToolsInput,
} from "@langchain/core/language_models/chat_models";
import type { ChatResult } from "@langchain/core/outputs";

import { LangGraphModule, getGraphFacadeToken, lazyModel } from "../index";
import type { LangGraphRunnable } from "../index";
import { LangGraphAgent } from "../agent/agent.decorator";
import { OrderService, OrderTools } from "./fixtures";

const FAST = Symbol.for("lazy-agent:ChatModel:fast");
const MISSING = Symbol.for("lazy-agent:ChatModel:missing");

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
});
