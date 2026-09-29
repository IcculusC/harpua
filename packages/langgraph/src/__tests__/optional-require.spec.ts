import { createRequire } from "node:module";
import * as path from "node:path";

import { AIMessage, HumanMessage } from "@langchain/core/messages";
import { describe, expect, it } from "vitest";

import { requireOptionalModule, requirePeerOf } from "../optional-require.js";

const hostRequire = createRequire(path.join(import.meta.dirname, "..", "..", "package.json"));

describe("optional-require", () => {
  it("loads peers as the same ESM instance the app imports (no CJS copy of core)", () => {
    const core = requireOptionalModule("@langchain/core/messages") as {
      AIMessage: typeof AIMessage;
    };
    expect(core.AIMessage).toBe(AIMessage);
  });

  it("throws a module-not-found code for a missing peer", () => {
    expect(() => requireOptionalModule("@harpua/definitely-not-installed")).toThrow(
      expect.objectContaining({ code: "ERR_MODULE_NOT_FOUND" }),
    );
  });

  it("stays synchronous", () => {
    expect(requireOptionalModule("@langchain/langgraph-checkpoint-sqlite")).not.toBeInstanceOf(
      Promise,
    );
  });

  it("requirePeerOf resolves a driver relative to the peer that ships it", () => {
    const host = "@langchain/langgraph-checkpoint-mongodb";
    const viaHost = createRequire(hostRequire.resolve(host))("mongodb");
    expect(requirePeerOf("mongodb", host)).toBe(viaHost);
  });

  it("a sqlite checkpointer round-trip returns messages of the app's own classes", async () => {
    const { SqliteSaver } = requireOptionalModule("@langchain/langgraph-checkpoint-sqlite") as any;
    const { StateGraph, StateSchema, MessagesValue, START, END } = await import(
      "@langchain/langgraph"
    );
    const State = new StateSchema({ messages: MessagesValue });
    const graph = new StateGraph(State)
      .addNode("n", () => ({ messages: [new AIMessage("hi")] }))
      .addEdge(START, "n")
      .addEdge("n", END)
      .compile({ checkpointer: SqliteSaver.fromConnString(":memory:") });
    const cfg = { configurable: { thread_id: "t" } };
    await graph.invoke({ messages: [new HumanMessage("yo")] }, cfg);
    const snap = await graph.getState(cfg);
    const msgs = snap.values.messages as unknown[];
    expect(msgs[0]).toBeInstanceOf(HumanMessage);
    expect(msgs[1]).toBeInstanceOf(AIMessage);
  });
});
