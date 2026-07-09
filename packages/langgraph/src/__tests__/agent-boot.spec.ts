import { Test } from "@nestjs/testing";
import type { INestApplication } from "@nestjs/common";
import { StateSchema, MessagesValue } from "@langchain/langgraph";
import { AIMessage, HumanMessage, ToolMessage } from "@langchain/core/messages";
import {
  BaseChatModel,
  type BindToolsInput,
} from "@langchain/core/language_models/chat_models";
import type { ChatResult } from "@langchain/core/outputs";

import { LangGraphModule, getGraphFacadeToken } from "../index";
import type { LangGraphRunnable } from "../index";
import { LangGraphAgent } from "../agent/agent.decorator";
import { OrderService, OrderTools } from "./fixtures";

const CHAT_MODEL = Symbol.for("agent-boot:CHAT_MODEL");

/**
 * A two-turn scripted `BaseChatModel`: requests `lookup_order`, then — once
 * the tool result comes back — answers in plain text. Mirrors the minimal
 * fake-model style already used by `binding.spec.ts`'s `RecordingModel`
 * rather than pulling in `@harpua/langgraph-testing` (which peer-depends on
 * this package — a devDependency the other way round would be a circular
 * workspace/build-graph dependency turbo rejects outright).
 */
class ScriptedModel extends BaseChatModel {
  private turn = 0;

  constructor() {
    super({});
  }

  _llmType(): string {
    return "agent-boot-scripted";
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
  name: "support",
  state: new StateSchema({ messages: MessagesValue }),
  model: CHAT_MODEL,
  tools: [OrderTools],
})
class SupportAgent {}

describe("@LangGraphAgent end-to-end boot", () => {
  let app: INestApplication;

  afterEach(async () => {
    await app?.close();
  });

  it("boots and runs a @LangGraphAgent end-to-end", async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        LangGraphModule.forRoot(),
        LangGraphModule.forFeature([SupportAgent]),
      ],
      providers: [
        OrderTools,
        OrderService,
        { provide: CHAT_MODEL, useClass: ScriptedModel },
      ],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();

    const agent = app.get<LangGraphRunnable>(getGraphFacadeToken({ name: "support" }));
    const res: any = await agent.invoke({
      messages: [new HumanMessage("look up order 42")],
    });

    expect(res.messages.some((m: any) => m instanceof ToolMessage)).toBe(true);
    expect(res.loop.iteration).toBeGreaterThanOrEqual(2);
  });
});
