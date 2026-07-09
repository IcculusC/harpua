import { AIMessage, HumanMessage } from "@langchain/core/messages";
import { composeModelWrap } from "../middleware/model-wrap";

it("composes wrapModelCall in onion order (first = outermost)", async () => {
  const order: string[] = [];
  const A = { async wrapModelCall(req: any, next: any) { order.push("A-in"); const r = await next(req); order.push("A-out"); return r; } };
  const B = { async wrapModelCall(req: any, next: any) { order.push("B-in"); const r = await next(req); order.push("B-out"); return r; } };
  const invoke = async () => { order.push("model"); return new AIMessage("ok"); };
  const chain = composeModelWrap([A, B], invoke);
  const out = await chain({ messages: [new HumanMessage("hi")], model: {} as any, state: {}, withModel(m){ return { ...this, model: m }; } });
  expect(out.content).toBe("ok");
  expect(order).toEqual(["A-in", "B-in", "model", "B-out", "A-out"]);
});

it("skips middleware without wrapModelCall and supports next×0/×N", async () => {
  const Retry = { async wrapModelCall(req: any, next: any) { try { return await next(req); } catch { return next(req); } } };
  let calls = 0;
  const invoke = async () => { calls++; if (calls === 1) throw new Error("boom"); return new AIMessage("recovered"); };
  const chain = composeModelWrap([{}, Retry], invoke);
  const out = await chain({ messages: [], model: {} as any, state: {}, withModel(m){ return { ...this, model: m }; } });
  expect(out.content).toBe("recovered");
  expect(calls).toBe(2);
});
