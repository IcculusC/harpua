import { Test } from "@nestjs/testing";
import { AIMessage, HumanMessage, SystemMessage } from "@langchain/core/messages";
import type { Provider, Type } from "@nestjs/common";

import {
  makeSystemPromptMiddleware,
  type SystemPromptMiddlewareConfig,
} from "../agent/system-prompt-middleware";
import type { ModelRequest } from "../middleware/middleware.types";

async function bootMiddleware(
  systemPrompt: SystemPromptMiddlewareConfig["systemPrompt"],
  providers: Provider[] = [],
) {
  const Middleware = makeSystemPromptMiddleware({ systemPrompt });
  const moduleRef = await Test.createTestingModule({
    providers: [...providers, Middleware as Type<unknown>],
  }).compile();
  return moduleRef.get(Middleware);
}

const echo = async (req: ModelRequest<any>) =>
  new AIMessage(String((req.messages[0] as SystemMessage).content));

const request = () => ({ messages: [new HumanMessage("hi")] }) as ModelRequest<any>;

describe("systemPrompt as a function source", () => {
  it("re-invokes the source on every model turn, so a rebuilt prefix is observed", async () => {
    const skills = ["alpha"];
    const mw = await bootMiddleware(() => `SKILLS: ${skills.join(", ")}`);

    const turn1 = await mw.wrapModelCall(request(), echo);
    skills.push("beta");
    const turn2 = await mw.wrapModelCall(request(), echo);

    expect(turn1.content).toBe("SKILLS: alpha");
    expect(turn2.content).toBe("SKILLS: alpha, beta");
  });

  it("awaits an async source", async () => {
    const mw = await bootMiddleware(async () => "async prompt");
    const reply = await mw.wrapModelCall(request(), echo);
    expect(reply.content).toBe("async prompt");
  });

  it("treats a plain (non-arrow) function as a source too", async () => {
    const mw = await bootMiddleware(function plainSource() {
      return "plain-function prompt";
    });
    const reply = await mw.wrapModelCall(request(), echo);
    expect(reply.content).toBe("plain-function prompt");
  });

  it("rejects loudly when a source returns a non-string", async () => {
    const mw = await bootMiddleware(() => undefined as unknown as string);
    await expect(mw.wrapModelCall(request(), echo)).rejects.toThrow(/string/i);
  });

  it("still skips the prepend when the request already leads with a SystemMessage", async () => {
    const source = jest.fn(() => "should not land");
    const mw = await bootMiddleware(source);

    const persisted = new SystemMessage("persisted prompt");
    const reply = await mw.wrapModelCall(
      { messages: [persisted, new HumanMessage("hi")] } as ModelRequest<any>,
      echo,
    );

    expect(reply.content).toBe("persisted prompt");
    expect(source).not.toHaveBeenCalled();
  });
});

describe("systemPrompt existing forms (unchanged)", () => {
  it("bakes a string literal", async () => {
    const mw = await bootMiddleware("literal prompt");
    const reply = await mw.wrapModelCall(request(), echo);
    expect(reply.content).toBe("literal prompt");
  });

  it("resolves a symbol token from DI", async () => {
    const TOKEN = Symbol("PROMPT");
    const mw = await bootMiddleware(TOKEN, [{ provide: TOKEN, useValue: "from DI" }]);
    const reply = await mw.wrapModelCall(request(), echo);
    expect(reply.content).toBe("from DI");
  });

  it("treats a CLASS as a DI token, never as a source to call", async () => {
    class PromptToken {}
    const mw = await bootMiddleware(PromptToken, [
      { provide: PromptToken, useValue: "class-token prompt" },
    ]);
    const reply = await mw.wrapModelCall(request(), echo);
    expect(reply.content).toBe("class-token prompt");
  });
});
