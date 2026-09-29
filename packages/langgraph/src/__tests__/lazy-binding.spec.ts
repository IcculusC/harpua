import { describe, it, expect, afterEach } from "vitest";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import {
  AIMessage,
  HumanMessage,
  type BaseMessage,
} from "@langchain/core/messages";
import {
  BaseChatModel,
  type BindToolsInput,
} from "@langchain/core/language_models/chat_models";
import type { ChatResult } from "@langchain/core/outputs";
import { StateSchema, MessagesValue } from "@langchain/langgraph";
import { z } from "zod";

import {
  LangGraph,
  provideGraphBoundModel,
  lazyModel,
  defineEdges,
  START,
  END,
  type GraphBoundModel,
  type StateOf,
} from "../index";
import { OrderService, OrderTools } from "./fixtures";

const MessagesState = new StateSchema({ messages: MessagesValue });
type MsgState = StateOf<typeof MessagesState>;

// Structurally-valid minimal edges — the binding helpers only read the graph's
// `tools` metadata (the graph is never compiled here), but follow the same
// `defineEdges` shape binding.spec.ts uses; a bare `[]` is not the convention.
const minimalEdges = defineEdges<MsgState>([{ from: START, to: END }]);

@LangGraph({ name: "lazyBoundTools", state: MessagesState, tools: [OrderTools] })
class LazyGraph {
  edges = minimalEdges;
}

class RecordingModel extends BaseChatModel {
  public boundTools: BindToolsInput[] | undefined;
  constructor() {
    super({});
  }
  _llmType(): string {
    return "recording";
  }
  bindTools(tools: BindToolsInput[]): this {
    this.boundTools = tools;
    return this;
  }
  async _generate(): Promise<ChatResult> {
    return { generations: [{ message: new AIMessage("ok"), text: "ok" }] };
  }
}

const BOUND = Symbol.for("lazy:BOUND");
const ARM = Symbol.for("lazy:ARM");
const MISSING = Symbol.for("lazy:MISSING_ARM");

describe("provideGraphBoundModel — lazy", () => {
  let app: INestApplication;
  afterEach(async () => {
    await app?.close();
  });

  it("does NOT resolve the arm at init when the token is unregistered (no boot crash)", async () => {
    const built = await Test.createTestingModule({
      providers: [
        OrderService,
        OrderTools,
        provideGraphBoundModel({ provide: BOUND, graph: LazyGraph, model: lazyModel(MISSING) }),
      ],
    }).compile();
    app = built.createNestApplication();
    // The eager path would throw here on the null arm; the lazy path must not.
    await expect(app.init()).resolves.toBeDefined();
    expect(app.get(BOUND)).toBeDefined(); // the proxy is present
  });

  it("resolves + binds tools on first call", async () => {
    const built = await Test.createTestingModule({
      providers: [
        OrderService,
        OrderTools,
        { provide: ARM, useClass: RecordingModel },
        provideGraphBoundModel({ provide: BOUND, graph: LazyGraph, model: lazyModel(ARM) }),
      ],
    }).compile();
    app = built.createNestApplication();
    await app.init();
    const bound = app.get<GraphBoundModel>(BOUND);
    const arm = app.get<RecordingModel>(ARM);
    expect(arm.boundTools).toBeUndefined(); // not bound yet — lazy
    await bound.invoke([new HumanMessage("hi")] as BaseMessage[]);
    expect(arm.boundTools).toBeDefined(); // bound on first call
    expect((arm.boundTools as { name: string }[]).map((t) => t.name)).toContain("lookup_order");
  });

  it("throws the null guard on first use, and again on the next call (per-call)", async () => {
    const built = await Test.createTestingModule({
      providers: [
        OrderService,
        OrderTools,
        provideGraphBoundModel({ provide: BOUND, graph: LazyGraph, model: lazyModel(MISSING) }),
      ],
    }).compile();
    app = built.createNestApplication();
    await app.init();
    const bound = app.get<GraphBoundModel>(BOUND);
    // The proxy resolves synchronously at the call, so the missing-arm guard
    // throws synchronously — assert with expect(fn).toThrow, not `.rejects`
    // (there is no promise; the throw escapes before one is created). Throwing
    // on BOTH calls proves the failure is per-call, not memoized.
    const pattern = /lazyModel token .*MISSING_ARM.* null at first use/s;
    expect(() => bound.invoke([new HumanMessage("x")] as BaseMessage[])).toThrow(pattern);
    expect(() => bound.invoke([new HumanMessage("y")] as BaseMessage[])).toThrow(pattern);
  });
});
