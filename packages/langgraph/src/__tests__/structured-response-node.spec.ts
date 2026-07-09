import { z } from "zod";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { makeStructuredResponseNode } from "../agent/structured-response-node";

const MODEL_TOKEN = "MODEL_TOKEN";

const schema = z.object({
  status: z.string(),
  reason: z.string(),
});

describe("makeStructuredResponseNode", () => {
  it("resolves the base model, coerces via withStructuredOutput, and returns { outcome }", async () => {
    const withStructuredOutputSpy = jest.fn();
    let capturedMessages: unknown[] | undefined;

    const fakeModel = {
      withStructuredOutput: (schemaArg: unknown) => {
        withStructuredOutputSpy(schemaArg);
        return {
          invoke: async (messages: unknown[]) => {
            capturedMessages = messages;
            return { status: "escalate", reason: "budget" };
          },
        };
      },
    };

    const stubModuleRef = {
      get(token: unknown) {
        if (token === MODEL_TOKEN) return fakeModel;
        throw new Error(`unexpected token: ${String(token)}`);
      },
    };

    const StructuredResponseNode = makeStructuredResponseNode({
      modelToken: MODEL_TOKEN,
      schema,
    });
    const node = new StructuredResponseNode(stubModuleRef as any);

    const humanMessage = new HumanMessage("wrap it up");
    const result = await node.run({ messages: [humanMessage] }, {} as any);

    expect(result).toEqual({
      outcome: { status: "escalate", reason: "budget" },
    });
    expect(withStructuredOutputSpy).toHaveBeenCalledWith(schema);
    expect(capturedMessages).toHaveLength(2);
    expect(capturedMessages![0]).toBeInstanceOf(SystemMessage);
    expect((capturedMessages![0] as SystemMessage).content).toBe(
      "Return the final answer strictly as the requested structured object.",
    );
    expect(capturedMessages![1]).toBe(humanMessage);
  });
});
