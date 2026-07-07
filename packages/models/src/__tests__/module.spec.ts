import { Injectable } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { AIMessage, HumanMessage } from "@langchain/core/messages";
import { BaseChatModel } from "@langchain/core/language_models/chat_models";

import { ChatModelModule } from "../chat-model.module";
import { CHAT_MODEL } from "../constants";
import { InjectChatModel } from "../decorators";
import { MockChatModel } from "../mock-chat-model";
import { resetChatModelRegistry } from "../registry";
import { stubEnv } from "./env-fixture";

@Injectable()
class Consumer {
  constructor(
    @InjectChatModel() readonly def: BaseChatModel,
    @InjectChatModel("fast") readonly fast: BaseChatModel,
  ) {}
}

describe("ChatModelModule DI wiring", () => {
  let restore: () => void;

  beforeEach(() => resetChatModelRegistry());
  afterEach(() => restore?.());

  it("boots the default mock with empty env and is injectable via CHAT_MODEL", async () => {
    ({ restore } = stubEnv({}));
    const moduleRef = await Test.createTestingModule({
      imports: [ChatModelModule.forRoot()],
    }).compile();

    const model = moduleRef.get<BaseChatModel>(CHAT_MODEL);
    expect(model).toBeInstanceOf(MockChatModel);
    await moduleRef.close();
  });

  it("resolves @InjectChatModel() (default) and @InjectChatModel('fast') with prefixed env", async () => {
    ({ restore } = stubEnv({ FAST_MODEL_PROVIDER: "mock" }));
    const moduleRef = await Test.createTestingModule({
      imports: [
        ChatModelModule.forRoot(),
        ChatModelModule.register({ name: "fast" }),
      ],
      providers: [Consumer],
    }).compile();

    const consumer = moduleRef.get(Consumer);
    expect(consumer.def).toBeInstanceOf(MockChatModel);
    expect(consumer.fast).toBeInstanceOf(MockChatModel);

    const reply = (await consumer.fast.invoke([
      new HumanMessage("hi"),
    ])) as AIMessage;
    expect(reply.content).toBe("[mock:fast] you said: hi");
    await moduleRef.close();
  });

  it("uses defaults.mockModel through the module for the default token", async () => {
    ({ restore } = stubEnv({}));
    class Canned extends BaseChatModel {
      _llmType() {
        return "canned";
      }
      async _generate() {
        return {
          generations: [{ message: new AIMessage("canned"), text: "canned" }],
        };
      }
    }
    const moduleRef = await Test.createTestingModule({
      imports: [
        ChatModelModule.forRoot({ defaults: { mockModel: () => new Canned({}) } }),
      ],
    }).compile();

    const model = moduleRef.get<BaseChatModel>(CHAT_MODEL);
    expect(model._llmType()).toBe("canned");
    await moduleRef.close();
  });
});
