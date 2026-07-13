import { z } from "zod";
import { HumanMessage, SystemMessage, type BaseMessage } from "@langchain/core/messages";
import {
  makeStructuredResponseNode,
  ResponseFormatOptions,
} from "../agent/structured-response-node";

/**
 * Walkie report 010: the structured turn-ending call was a fixed black box —
 * one shot (a provider-roulette failure at the finish line threw away a turn
 * whose tool calls all succeeded), always the graph's cheap bound model
 * (unreachable by per-call routing OR wrapModelCall, by design), always a
 * full-context resend, always the same instruction. These options open each
 * choice; every default preserves the old behavior.
 */

const MODEL_TOKEN = "MODEL_TOKEN";
const SMART_TOKEN = "SMART_TOKEN";

const schema = z.object({ status: z.string() });

/** withStructuredOutput-capable fake whose invoke can be scripted per call. */
function fakeModel(script: Array<"ok" | "boom">, capture?: { messages?: unknown[] }) {
  let call = 0;
  return {
    invokes: () => call,
    withStructuredOutput: () => ({
      invoke: async (messages: unknown[]) => {
        if (capture) capture.messages = messages;
        const step = script[Math.min(call++, script.length - 1)];
        if (step === "boom") throw new Error("provider roulette");
        return { status: "done" };
      },
    }),
  };
}

function nodeWith(
  options: ResponseFormatOptions | undefined,
  models: Record<string, unknown>,
) {
  const stubModuleRef = {
    get(token: unknown) {
      const m = models[String(token)];
      if (!m) throw new Error(`unexpected token: ${String(token)}`);
      return m;
    },
  };
  const Node = makeStructuredResponseNode({
    modelToken: MODEL_TOKEN,
    schema,
    options: options === undefined ? undefined : ResponseFormatOptions.parse(options),
  });
  return new Node(stubModuleRef as any);
}

describe("responseFormatOptions", () => {
  it("model: routes the envelope call to a different token (facade/smart arm)", async () => {
    const cheap = fakeModel(["boom"]);
    const smart = fakeModel(["ok"]);
    const node = nodeWith({ model: SMART_TOKEN }, {
      [MODEL_TOKEN]: cheap,
      [SMART_TOKEN]: smart,
    });

    const result = await node.run({ messages: [new HumanMessage("q")] }, {} as any);
    expect(result).toEqual({ outcome: { status: "done" } });
    expect(cheap.invokes()).toBe(0); // the graph's bound model never consulted
    expect(smart.invokes()).toBe(1);
  });

  it("retries: a roulette failure is re-asked and the turn's outcome survives", async () => {
    const model = fakeModel(["boom", "ok"]);
    const node = nodeWith({ retries: 1 }, { [MODEL_TOKEN]: model });

    const result = await node.run({ messages: [new HumanMessage("q")] }, {} as any);
    expect(result).toEqual({ outcome: { status: "done" } });
    expect(model.invokes()).toBe(2);
  });

  it("retries exhausted rethrows the LAST error; default stays one-shot", async () => {
    const persistent = fakeModel(["boom", "boom", "boom"]);
    const node = nodeWith({ retries: 1 }, { [MODEL_TOKEN]: persistent });
    await expect(node.run({ messages: [] }, {} as any)).rejects.toThrow("provider roulette");
    expect(persistent.invokes()).toBe(2); // retries+1, never more

    const oneShot = fakeModel(["boom", "ok"]);
    const defaultNode = nodeWith(undefined, { [MODEL_TOKEN]: oneShot });
    await expect(defaultNode.run({ messages: [] }, {} as any)).rejects.toThrow();
    expect(oneShot.invokes()).toBe(1); // today's behavior preserved
  });

  it("messages: the selector picks the envelope's input (recent tail, not full context)", async () => {
    const capture: { messages?: unknown[] } = {};
    const model = fakeModel(["ok"], capture);
    const node = nodeWith(
      { messages: (msgs: BaseMessage[]) => msgs.slice(-2) },
      { [MODEL_TOKEN]: model },
    );

    const history = [new HumanMessage("old"), new HumanMessage("mid"), new HumanMessage("new")];
    await node.run({ messages: history }, {} as any);
    expect(capture.messages).toHaveLength(3); // instruction + 2 selected
    expect(capture.messages![1]).toBe(history[1]);
    expect(capture.messages![2]).toBe(history[2]);
  });

  it("instruction: replaces the fixed coercion system message", async () => {
    const capture: { messages?: unknown[] } = {};
    const model = fakeModel(["ok"], capture);
    const node = nodeWith(
      { instruction: "Emit the outcome envelope only." },
      { [MODEL_TOKEN]: model },
    );

    await node.run({ messages: [new HumanMessage("q")] }, {} as any);
    const head = capture.messages![0] as SystemMessage;
    expect(head).toBeInstanceOf(SystemMessage);
    expect(head.content).toBe("Emit the outcome envelope only.");
  });

  it("rejects junk options at parse time", () => {
    expect(() => ResponseFormatOptions.parse({ retries: -1 })).toThrow();
    expect(() => ResponseFormatOptions.parse({ instruction: "" })).toThrow();
    expect(() => ResponseFormatOptions.parse({ messages: "not a fn" })).toThrow();
  });

  it("parse({}) yields today's defaults", () => {
    const parsed = ResponseFormatOptions.parse({});
    expect(parsed.retries).toBe(0);
    expect(parsed.model).toBeUndefined();
    expect(parsed.messages).toBeUndefined();
    expect(parsed.instruction).toBeUndefined();
  });
});

/* End-to-end: the decorator option must survive the compiler into the node —
 * a wiring drop would silently revert every option to legacy behavior. */
import { Test } from "@nestjs/testing";
import { AIMessage } from "@langchain/core/messages";
import {
  BaseChatModel,
  type BindToolsInput,
} from "@langchain/core/language_models/chat_models";
import type { ChatResult } from "@langchain/core/outputs";
import { StateSchema, MessagesValue } from "@langchain/langgraph";
import { LangGraphModule, getGraphFacadeToken } from "../index";
import { LangGraphAgent } from "../agent/agent.decorator";

const CHAT = Symbol.for("rfo:CHAT");
const ENVELOPE = Symbol.for("rfo:ENVELOPE");

class PlainReplyModel extends BaseChatModel {
  constructor() {
    super({ maxRetries: 0 });
  }
  _llmType(): string {
    return "plain";
  }
  bindTools(_t: BindToolsInput[]): this {
    return this;
  }
  async _generate(): Promise<ChatResult> {
    return { generations: [{ message: new AIMessage("done"), text: "done" }] };
  }
  withStructuredOutput(): any {
    return { invoke: async () => { throw new Error("cheap arm cannot coerce"); } };
  }
}

class EnvelopeModel extends PlainReplyModel {
  structuredCalls = 0;
  private failuresLeft = 1; // roulette: fail once, then succeed
  withStructuredOutput(): any {
    return {
      invoke: async () => {
        this.structuredCalls++;
        if (this.failuresLeft-- > 0) throw new Error("roulette");
        return { status: "wrapped" };
      },
    };
  }
}

@LangGraphAgent({
  name: "rfoAgent",
  state: new StateSchema({ messages: MessagesValue }),
  model: CHAT,
  responseFormat: schema,
  responseFormatOptions: { model: ENVELOPE, retries: 1 },
})
class RfoAgent {}

describe("responseFormatOptions wiring (decorator -> compiler -> node)", () => {
  it("routes the envelope to the optioned token and retries through the roulette failure", async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        LangGraphModule.forRoot(),
        LangGraphModule.forFeature([RfoAgent], {
          providers: [
            { provide: CHAT, useClass: PlainReplyModel },
            { provide: ENVELOPE, useClass: EnvelopeModel },
          ],
        }),
      ],
    }).compile();
    const app = moduleRef.createNestApplication();
    await app.init();
    try {
      const agent = app.get<any>(getGraphFacadeToken({ name: "rfoAgent" }));
      const result = await agent.invoke({ messages: [new HumanMessage("go")] });
      // The cheap arm would THROW on coercion; only the optioned token +
      // retry can produce this outcome.
      expect(result.outcome).toEqual({ status: "wrapped" });
      const envelope = app.get<EnvelopeModel>(ENVELOPE);
      expect(envelope.structuredCalls).toBe(2);
    } finally {
      await app.close();
    }
  });
});

describe("review-pinned edges", () => {
  it("typoed option keys are rejected, not silently stripped", () => {
    expect(() => ResponseFormatOptions.parse({ retires: 5 } as any)).toThrow();
  });

  it("the selector gets a COPY — mutating it cannot corrupt the state's messages channel", async () => {
    const model = fakeModel(["ok"]);
    const node = nodeWith(
      { messages: (msgs: BaseMessage[]) => msgs.reverse().slice(0, 1) }, // hostile selector
      { [MODEL_TOKEN]: model },
    );
    const history = [new HumanMessage("first"), new HumanMessage("second")];
    await node.run({ messages: history }, {} as any);
    expect((history[0] as HumanMessage).content).toBe("first"); // state order intact
    expect((history[1] as HumanMessage).content).toBe("second");
  });

  it("a selector that forgets its return fails loudly instead of silently resending full history", async () => {
    const model = fakeModel(["ok"]);
    const node = nodeWith(
      { messages: ((msgs: BaseMessage[]) => { msgs.slice(-2); }) as any },
      { [MODEL_TOKEN]: model },
    );
    await expect(node.run({ messages: [new HumanMessage("q")] }, {} as any)).rejects.toThrow(
      /messages.*array/i,
    );
    expect(model.invokes()).toBe(0);
  });

  it("an aborted signal stops the retry loop instead of re-asking with a dead request", async () => {
    const model = fakeModel(["boom", "boom", "boom", "boom"]);
    const node = nodeWith({ retries: 3 }, { [MODEL_TOKEN]: model });
    const ac = new AbortController();
    ac.abort();
    await expect(
      node.run({ messages: [] }, { signal: ac.signal } as any),
    ).rejects.toThrow();
    expect(model.invokes()).toBe(1); // no blind re-asks after abort
  });
});

describe("compiler guards", () => {
  it("responseFormatOptions without responseFormat throws at decorator eval, naming the agent", () => {
    expect(() => {
      @LangGraphAgent({
        name: "orphanOptions",
        state: new StateSchema({ messages: MessagesValue }),
        model: CHAT,
        responseFormatOptions: { retries: 1 },
      })
      class OrphanAgent {}
      void OrphanAgent;
    }).toThrow(/orphanOptions.*responseFormat/s);
  });

  it("junk options throw at decorator eval, naming the agent", () => {
    expect(() => {
      @LangGraphAgent({
        name: "junkOptions",
        state: new StateSchema({ messages: MessagesValue }),
        model: CHAT,
        responseFormat: schema,
        responseFormatOptions: { retries: -1 },
      })
      class JunkAgent {}
      void JunkAgent;
    }).toThrow(/junkOptions/);
  });
});
