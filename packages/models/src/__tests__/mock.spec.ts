import { AIMessage, HumanMessage } from "@langchain/core/messages";
import { BaseChatModel } from "@langchain/core/language_models/chat_models";

import { buildChatModel } from "../model-factory";
import { MockChatModel } from "../mock-chat-model";
import type { Registration } from "../interfaces";

const defaultReg: Registration = { name: "default", envPrefix: "" };

describe("mock arm (zero-config default)", () => {
  it("boots with empty env and returns the built-in MockChatModel", () => {
    const model = buildChatModel(defaultReg, {});
    expect(model).toBeInstanceOf(MockChatModel);
    expect(model._llmType()).toBe("harpua-mock");
  });

  it("produces a deterministic, tagged echo with no tool calls", async () => {
    const model = buildChatModel(defaultReg, {});
    const reply = (await model.invoke([
      new HumanMessage("hello there"),
    ])) as AIMessage;
    expect(reply.content).toBe("[mock:default] you said: hello there");
    expect(reply.tool_calls ?? []).toHaveLength(0);
  });

  it("tags the echo with the registration name", async () => {
    const reg: Registration = { name: "fast", envPrefix: "FAST_" };
    const model = buildChatModel(reg, {});
    const reply = (await model.invoke([new HumanMessage("ping")])) as AIMessage;
    expect(reply.content).toBe("[mock:fast] you said: ping");
  });

  it("uses defaults.mockModel factory when provided (it wins over the built-in)", () => {
    class Sentinel extends BaseChatModel {
      _llmType() {
        return "sentinel";
      }
      async _generate() {
        return { generations: [{ message: new AIMessage("x"), text: "x" }] };
      }
    }
    const factory = jest.fn(() => new Sentinel({}));
    const reg: Registration = {
      name: "default",
      envPrefix: "",
      defaults: { mockModel: factory },
    };

    const model = buildChatModel(reg, {});
    expect(model).toBeInstanceOf(Sentinel);
    expect(model).not.toBeInstanceOf(MockChatModel);
    expect(factory).toHaveBeenCalledTimes(1);
  });

  it("honours defaults.provider=mock without any env", () => {
    const reg: Registration = {
      name: "default",
      envPrefix: "",
      defaults: { provider: "mock" },
    };
    expect(buildChatModel(reg, {})).toBeInstanceOf(MockChatModel);
  });
});
