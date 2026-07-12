import { Test } from "@nestjs/testing";
import type { INestApplication } from "@nestjs/common";
import { StateSchema, MessagesValue } from "@langchain/langgraph";
import {
  AIMessage,
  AIMessageChunk,
  HumanMessage,
  isAIMessage,
} from "@langchain/core/messages";
import {
  BaseChatModel,
  type BindToolsInput,
} from "@langchain/core/language_models/chat_models";
import type { ChatResult } from "@langchain/core/outputs";

import { LangGraphModule, getGraphFacadeToken } from "../index";
import type { LangGraphRunnable } from "../index";
import { LangGraphAgent } from "../agent/agent.decorator";

/**
 * Pin for walkie report 007: token usage must survive from the in-flight
 * reply to the CHECKPOINTED message. The production path returns an
 * AIMessageChunk (not an AIMessage), and real providers split their counts
 * across usage_metadata and response_metadata.tokenUsage — a fake-model
 * suite without usage data cannot see this class of loss, which is how a
 * silently dead token trigger shipped.
 */

const CHAT_MODEL = Symbol.for("usage-persistence:CHAT_MODEL");
const AgentState = new StateSchema({ messages: MessagesValue });

/** Replies with a CHUNK carrying both usage shapes, like a streamed arm. */
class ChunkUsageModel extends BaseChatModel {
  constructor() {
    super({ maxRetries: 0 });
  }
  _llmType(): string {
    return "chunk-usage";
  }
  bindTools(_tools: BindToolsInput[]): this {
    return this;
  }
  async _generate(): Promise<ChatResult> {
    const message = new AIMessageChunk({
      content: "done",
      usage_metadata: { input_tokens: 131_935, output_tokens: 121, total_tokens: 132_056 },
      response_metadata: {
        tokenUsage: { prompt_tokens: 131_935, completion_tokens: 121, total_tokens: 132_056 },
      },
    });
    return { generations: [{ message, text: "done" }] };
  }
}

@LangGraphAgent({
  name: "usageKeeper",
  state: AgentState,
  model: CHAT_MODEL,
})
class UsageKeeperAgent {}

describe("usage metadata survives to the checkpointed message", () => {
  let app: INestApplication;
  let agent: LangGraphRunnable<any>;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        LangGraphModule.forRoot({ checkpointer: { type: "memory" } }),
        LangGraphModule.forFeature([UsageKeeperAgent], {
          providers: [{ provide: CHAT_MODEL, useClass: ChunkUsageModel }],
        }),
      ],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    agent = app.get(getGraphFacadeToken({ name: "usageKeeper" }));
  });

  afterAll(async () => {
    await app?.close();
  });

  it("persists a plain AIMessage retaining usage_metadata AND response_metadata after a chunk reply", async () => {
    const config = { configurable: { thread_id: "t-usage" } };
    await agent.invoke({ messages: [new HumanMessage("go")] }, config);

    const snapshot = (await agent.getState(config)) as any;
    const persisted: unknown[] = snapshot.values?.messages ?? [];
    const lastAi = [...persisted].reverse().find((m) => isAIMessage(m as any)) as any;

    expect(lastAi).toBeDefined();
    // Normalized to a plain AIMessage — no chunk reaches the checkpoint.
    expect(lastAi instanceof AIMessage).toBe(true);
    expect(lastAi instanceof AIMessageChunk).toBe(false);
    expect(lastAi.usage_metadata).toEqual({
      input_tokens: 131_935,
      output_tokens: 121,
      total_tokens: 132_056,
    });
    expect(lastAi.response_metadata).toEqual({
      tokenUsage: { prompt_tokens: 131_935, completion_tokens: 121, total_tokens: 132_056 },
    });
  });
});
