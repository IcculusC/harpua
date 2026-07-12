import {
  AIMessage,
  HumanMessage,
  SystemMessage,
  ToolMessage,
} from "@langchain/core/messages";

import { lastNonSystemIsHuman } from "../middleware/turn-start";
import { composeModelWrap } from "../middleware/model-wrap";
import type { ModelRequest } from "../middleware/middleware.types";

describe("lastNonSystemIsHuman", () => {
  it("is true when the human turn is the literal last message", () => {
    expect(lastNonSystemIsHuman([new HumanMessage("hi")])).toBe(true);
  });

  it("is true when a sibling middleware appended a SystemMessage after the human turn", () => {
    expect(
      lastNonSystemIsHuman([new HumanMessage("hi"), new SystemMessage("injected block")]),
    ).toBe(true);
  });

  it("skips any number of trailing SystemMessages", () => {
    expect(
      lastNonSystemIsHuman([
        new HumanMessage("hi"),
        new SystemMessage("one"),
        new SystemMessage("two"),
      ]),
    ).toBe(true);
  });

  it("is false mid-loop, when the model has already replied", () => {
    expect(
      lastNonSystemIsHuman([new HumanMessage("hi"), new AIMessage("hello")]),
    ).toBe(false);
  });

  it("is false after a tool result, even with a trailing SystemMessage", () => {
    expect(
      lastNonSystemIsHuman([
        new HumanMessage("hi"),
        new AIMessage("calling tool"),
        new ToolMessage({ content: "result", tool_call_id: "t1" }),
        new SystemMessage("injected block"),
      ]),
    ).toBe(false);
  });

  it("is false on an empty list and on system-only messages", () => {
    expect(lastNonSystemIsHuman([])).toBe(false);
    expect(lastNonSystemIsHuman([new SystemMessage("base prompt")])).toBe(false);
  });

  it("ignores a LEADING SystemMessage — only the tail scan matters", () => {
    expect(
      lastNonSystemIsHuman([new SystemMessage("base prompt"), new HumanMessage("hi")]),
    ).toBe(true);
  });
});

describe("composed tail-append middlewares gated on lastNonSystemIsHuman", () => {
  function tailAppender(name: string, fired: Record<string, boolean>) {
    return {
      async wrapModelCall(req: ModelRequest<any>, next: (r: ModelRequest<any>) => Promise<AIMessage>) {
        if (!lastNonSystemIsHuman(req.messages)) return next(req);
        fired[name] = true;
        return next({
          ...req,
          messages: [...req.messages, new SystemMessage(`${name} block`)],
        });
      },
    };
  }

  it("both fire even though each sees the previous one's appended trailer", async () => {
    const fired: Record<string, boolean> = { outer: false, inner: false };
    const chain = composeModelWrap(
      [tailAppender("outer", fired), tailAppender("inner", fired)],
      async (req) => new AIMessage(`saw ${req.messages.length}`),
    );

    const reply = await chain({ messages: [new HumanMessage("hi")] } as ModelRequest<any>);

    expect(fired).toEqual({ outer: true, inner: true });
    expect(reply.content).toBe("saw 3");
  });
});
