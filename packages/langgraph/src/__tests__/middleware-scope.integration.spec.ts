import { Test } from "@nestjs/testing";
import type { INestApplication } from "@nestjs/common";
import { Inject, Injectable } from "@nestjs/common";
import { StateSchema, MessagesValue } from "@langchain/langgraph";
import { AIMessage, HumanMessage, ToolMessage, isToolMessage } from "@langchain/core/messages";
import {
  BaseChatModel,
  type BindToolsInput,
} from "@langchain/core/language_models/chat_models";
import type { ChatResult } from "@langchain/core/outputs";

import { LangGraphModule, getGraphFacadeToken, LangGraphTool } from "../index";
import type { LangGraphRunnable } from "../index";
import { LangGraphAgent } from "../agent/agent.decorator";
import { BudgetMiddleware, provideBudget } from "../middleware/budget.middleware";
import { LangGraphMiddleware } from "../middleware/middleware.decorator";
import type { LangGraphMiddleware as MiddlewareContract } from "../middleware/middleware.interface";
import type { ModelRequest } from "../middleware/middleware.types";
import { z } from "zod";

/**
 * Field report 015: middleware used to resolve FLAT by class
 * (`moduleRef.get(cls, { strict: false })`), so two graphs naming the same
 * middleware class shared ONE instance — bound to whichever forFeature scope
 * Nest instantiated first. Per-graph options silently cross-contaminated
 * (live incident: a subagent's 1M-token Budget governed the flagship graph).
 *
 * These tests boot TWO feature modules that both name the same middleware
 * classes with different scope-level options, and assert each graph is
 * governed by ITS OWN scope. Nest's flat lookup returns the LAST-registered
 * module's instance, so with tight/B registered first the wide/A instances
 * won under the old code — a stable, deterministic RED on the tight/B
 * assertions (tight ran to 8 cycles; B's replies carried A's tag), not
 * instantiation-order roulette.
 *
 * All three resolution paths are pinned:
 *  - node-hook middleware (Budget's beforeAgent/beforeModel) — hook-node
 *  - wrapModelCall middleware — call-model-node
 *  - wrapToolCall middleware — graph-tools' ToolNode assembly
 */

const AgentState = () => new StateSchema({ messages: MessagesValue });

/* ------------------------------------------------------------------ *
 * Budget scoping (hook-node path)
 * ------------------------------------------------------------------ */

class AlwaysToolModel extends BaseChatModel {
  generateCalls = 0;

  constructor() {
    super({ maxRetries: 0 });
  }

  _llmType(): string {
    return "always-tool";
  }

  bindTools(_tools: BindToolsInput[]): this {
    return this;
  }

  async _generate(): Promise<ChatResult> {
    this.generateCalls += 1;
    const message = new AIMessage({
      content: "",
      tool_calls: [
        {
          name: "echo",
          args: { text: String(this.generateCalls) },
          id: `call_${this.generateCalls}`,
          type: "tool_call",
        },
      ],
    });
    return { generations: [{ message, text: "" }] };
  }
}

@Injectable()
class EchoTools {
  @LangGraphTool({
    name: "echo",
    description: "echoes",
    schema: z.object({ text: z.string() }),
  })
  echo({ text }: { text: string }): string {
    return `echo:${text}`;
  }
}

const WIDE_MODEL = Symbol("scope-spec:WIDE_MODEL");
const TIGHT_MODEL = Symbol("scope-spec:TIGHT_MODEL");

@LangGraphAgent({
  name: "scopeWideAgent",
  state: AgentState(),
  model: WIDE_MODEL,
  tools: [EchoTools],
  middleware: [BudgetMiddleware],
  recursionLimit: 100,
})
class ScopeWideAgent {}

@LangGraphAgent({
  name: "scopeTightAgent",
  state: AgentState(),
  model: TIGHT_MODEL,
  tools: [EchoTools],
  middleware: [BudgetMiddleware],
  recursionLimit: 100,
})
class ScopeTightAgent {}

/* ------------------------------------------------------------------ *
 * wrapModelCall + wrapToolCall scoping (call-model-node + graph-tools paths)
 * ------------------------------------------------------------------ */

const TAG = Symbol("scope-spec:TAG");

@LangGraphMiddleware()
class ModelTagMiddleware implements MiddlewareContract {
  constructor(@Inject(TAG) private readonly tag: string) {}

  async wrapModelCall(
    req: ModelRequest<any>,
    next: (req: ModelRequest<any>) => Promise<AIMessage>,
  ): Promise<AIMessage> {
    const reply = await next(req);
    if ((reply.tool_calls?.length ?? 0) > 0) return reply;
    return new AIMessage({
      content: `${String(reply.content)}${this.tag}`,
      usage_metadata: reply.usage_metadata,
      response_metadata: reply.response_metadata,
      additional_kwargs: reply.additional_kwargs,
      id: reply.id,
    });
  }
}

@LangGraphMiddleware()
class ToolTagMiddleware implements MiddlewareContract {
  constructor(@Inject(TAG) private readonly tag: string) {}

  async wrapToolCall(
    call: any,
    next: (call: any) => Promise<ToolMessage>,
  ): Promise<ToolMessage> {
    const msg = await next(call);
    return new ToolMessage({
      content: `${String(msg.content)}${this.tag}`,
      tool_call_id: msg.tool_call_id,
      name: msg.name,
      status: msg.status,
    });
  }
}

class OneToolThenDoneModel extends BaseChatModel {
  generateCalls = 0;

  constructor() {
    super({ maxRetries: 0 });
  }

  _llmType(): string {
    return "one-tool-then-done";
  }

  bindTools(_tools: BindToolsInput[]): this {
    return this;
  }

  async _generate(): Promise<ChatResult> {
    this.generateCalls += 1;
    const message =
      this.generateCalls === 1
        ? new AIMessage({
            content: "",
            tool_calls: [
              { name: "echo", args: { text: "x" }, id: "call_1", type: "tool_call" },
            ],
          })
        : new AIMessage({ content: "done" });
    return { generations: [{ message, text: "" }] };
  }
}

const TAG_A_MODEL = Symbol("scope-spec:TAG_A_MODEL");
const TAG_B_MODEL = Symbol("scope-spec:TAG_B_MODEL");

@LangGraphAgent({
  name: "tagAgentA",
  state: AgentState(),
  model: TAG_A_MODEL,
  tools: [EchoTools],
  middleware: [ModelTagMiddleware, ToolTagMiddleware],
})
class TagAgentA {}

@LangGraphAgent({
  name: "tagAgentB",
  state: AgentState(),
  model: TAG_B_MODEL,
  tools: [EchoTools],
  middleware: [ModelTagMiddleware, ToolTagMiddleware],
})
class TagAgentB {}

describe("middleware scope isolation across feature modules (report 015)", () => {
  let app: INestApplication;
  let wideModel: AlwaysToolModel;
  let tightModel: AlwaysToolModel;
  let tagAModel: OneToolThenDoneModel;
  let tagBModel: OneToolThenDoneModel;

  beforeAll(async () => {
    wideModel = new AlwaysToolModel();
    tightModel = new AlwaysToolModel();
    tagAModel = new OneToolThenDoneModel();
    tagBModel = new OneToolThenDoneModel();

    const moduleRef = await Test.createTestingModule({
      imports: [
        LangGraphModule.forRoot({}),
        // The TIGHT/B scopes come FIRST. Nest's flat lookup returns the
        // LAST-registered instance, so under the old flat-by-class
        // resolution the wide/A instances governed every graph and the
        // tight/B assertions below failed deterministically.
        LangGraphModule.forFeature([ScopeTightAgent], {
          providers: [
            ...provideBudget({
              maxCycles: 4,
              maxToolCalls: 100,
              maxTokens: 1_000_000,
              maxWallMs: 60_000,
            }),
            EchoTools,
            { provide: TIGHT_MODEL, useValue: tightModel },
          ],
        }),
        LangGraphModule.forFeature([ScopeWideAgent], {
          providers: [
            ...provideBudget({
              maxCycles: 8,
              maxToolCalls: 100,
              maxTokens: 1_000_000,
              maxWallMs: 60_000,
            }),
            EchoTools,
            { provide: WIDE_MODEL, useValue: wideModel },
          ],
        }),
        LangGraphModule.forFeature([TagAgentB], {
          providers: [
            { provide: TAG, useValue: "[B]" },
            ModelTagMiddleware,
            ToolTagMiddleware,
            EchoTools,
            { provide: TAG_B_MODEL, useValue: tagBModel },
          ],
        }),
        LangGraphModule.forFeature([TagAgentA], {
          providers: [
            { provide: TAG, useValue: "[A]" },
            ModelTagMiddleware,
            ToolTagMiddleware,
            EchoTools,
            { provide: TAG_A_MODEL, useValue: tagAModel },
          ],
        }),
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
  });

  it("each graph's Budget is governed by ITS OWN scope's caps (hook-node path)", async () => {
    const wide = app.get<LangGraphRunnable>(getGraphFacadeToken({ name: "scopeWideAgent" }));
    const tight = app.get<LangGraphRunnable>(getGraphFacadeToken({ name: "scopeTightAgent" }));

    await wide.invoke({ messages: [new HumanMessage("go")] });
    await tight.invoke({ messages: [new HumanMessage("go")] });

    // The incident shape: the tight scope's instance governing the wide graph
    // clips it at 4. Its own scope must let it run to 8.
    expect(wideModel.generateCalls).toBe(8);
    expect(tightModel.generateCalls).toBe(4);
  });

  describe("wrap middleware scoping (one invoke per agent — the scripted models are stateful)", () => {
    let resA: any;
    let resB: any;

    beforeAll(async () => {
      const a = app.get<LangGraphRunnable>(getGraphFacadeToken({ name: "tagAgentA" }));
      const b = app.get<LangGraphRunnable>(getGraphFacadeToken({ name: "tagAgentB" }));
      resA = await a.invoke({ messages: [new HumanMessage("go")] });
      resB = await b.invoke({ messages: [new HumanMessage("go")] });
    });

    it("each graph's wrapModelCall middleware carries ITS OWN scope's options (call-model-node path)", () => {
      const lastA = resA.messages[resA.messages.length - 1];
      const lastB = resB.messages[resB.messages.length - 1];
      expect(String(lastA.content)).toBe("done[A]");
      expect(String(lastB.content)).toBe("done[B]");
    });

    it("each graph's wrapToolCall middleware carries ITS OWN scope's options (graph-tools path)", () => {
      const toolA = resA.messages.filter((m: unknown) => isToolMessage(m as any)).pop();
      const toolB = resB.messages.filter((m: unknown) => isToolMessage(m as any)).pop();
      expect(String(toolA.content)).toContain("echo:x[A]");
      expect(String(toolB.content)).toContain("echo:x[B]");
    });
  });
});
