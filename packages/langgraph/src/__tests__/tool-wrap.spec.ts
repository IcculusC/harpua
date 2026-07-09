import { ToolMessage } from "@langchain/core/messages";
import { tool } from "@langchain/core/tools";
import { z } from "zod";

import { composeToolWrap } from "../middleware/tool-wrap";

function makeEchoTool() {
  const spy = jest.fn(async ({ x }: { x: number }) => String(x));
  const echoTool = tool(spy, {
    name: "echo",
    description: "Echo x back as a string.",
    schema: z.object({ x: z.number() }),
  });
  return { echoTool, spy };
}

describe("composeToolWrap", () => {
  it("returns the tool unchanged when no middleware implements wrapToolCall", () => {
    const { echoTool } = makeEchoTool();
    const wrapped = composeToolWrap(echoTool, [{}], () => ({}));
    expect(wrapped).toBe(echoTool);
  });

  it("composes wrapToolCall in onion order (first = outermost)", async () => {
    const order: string[] = [];
    const A = {
      async wrapToolCall(req: any, next: any) {
        order.push("A-in");
        const r = await next(req);
        order.push("A-out");
        return r;
      },
    };
    const B = {
      async wrapToolCall(req: any, next: any) {
        order.push("B-in");
        const r = await next(req);
        order.push("B-out");
        return r;
      },
    };
    const { echoTool, spy } = makeEchoTool();
    const wrapped = composeToolWrap(echoTool, [A, B], () => ({}));

    const result = await wrapped.invoke(
      { name: "echo", args: { x: 1 }, id: "t1", type: "tool_call" } as any,
      {},
    );

    order.splice(2, 0, "tool");
    expect(order).toEqual(["A-in", "B-in", "tool", "B-out", "A-out"]);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(result).toBeInstanceOf(ToolMessage);
    expect(String((result as ToolMessage).content)).toBe("1");
    expect((result as ToolMessage).tool_call_id).toBe("t1");
  });

  it("short-circuits when a middleware returns without calling next, skipping the real tool", async () => {
    const denied = new ToolMessage({
      content: "denied",
      tool_call_id: "t1",
      name: "echo",
    });
    const Gate = {
      async wrapToolCall(_req: any, _next: any) {
        return denied;
      },
    };
    const { echoTool, spy } = makeEchoTool();
    const wrapped = composeToolWrap(echoTool, [Gate], () => ({}));

    const result = await wrapped.invoke(
      { name: "echo", args: { x: 1 }, id: "t1", type: "tool_call" } as any,
      {},
    );

    expect(result).toBe(denied);
    expect(spy).not.toHaveBeenCalled();
  });

  it("calls stateOf(config) and attaches the result to the request", async () => {
    const seen: unknown[] = [];
    const Recorder = {
      async wrapToolCall(req: any, next: any) {
        seen.push(req.state);
        return next(req);
      },
    };
    const { echoTool } = makeEchoTool();
    const state = { foo: "bar" };
    const stateOf = jest.fn(() => state);
    const wrapped = composeToolWrap(echoTool, [Recorder], stateOf);

    await wrapped.invoke(
      { name: "echo", args: { x: 2 }, id: "t2", type: "tool_call" } as any,
      { configurable: {} },
    );

    expect(stateOf).toHaveBeenCalledWith({ configurable: {} });
    expect(seen).toEqual([state]);
  });

  it("normalizes raw-args invocation (no ToolCall envelope)", async () => {
    // @langchain/core's tool() only wraps output as a ToolMessage when the
    // reconstructed call carries a truthy tool_call_id (see
    // _formatToolOutput in @langchain/core/dist/tools/index.cjs); with no id
    // supplied it returns raw content, same as calling the un-proxied tool
    // with plain args. composeToolWrap defaults the missing id to "" (falsy)
    // rather than inventing one, so that real behavior is preserved.
    const { echoTool, spy } = makeEchoTool();
    let capturedId: string | undefined;
    const Recorder = {
      async wrapToolCall(req: any, next: any) {
        capturedId = req.id;
        return next(req);
      },
    };
    const wrapped = composeToolWrap(echoTool, [Recorder], () => ({}));

    const result = await wrapped.invoke({ x: 5 } as any);

    expect(spy).toHaveBeenCalledTimes(1);
    expect(result).toBe("5");
    expect(capturedId).toBe("");
  });
});
