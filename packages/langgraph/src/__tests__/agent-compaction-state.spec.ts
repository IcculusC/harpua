import { StateSchema, MessagesValue } from "@langchain/langgraph";
import { LangGraphAgent } from "../agent/agent.decorator";
import { getGraphMetadata } from "../decorators";
import { CompactionMiddleware } from "../middleware/compaction.middleware";

const MODEL = Symbol.for("m");

describe("agent decorator + compaction state", () => {
  it("adds a summary channel when a compaction middleware is present", () => {
    @LangGraphAgent({
      name: "withComp",
      state: new StateSchema({ messages: MessagesValue }),
      model: MODEL,
      middleware: [CompactionMiddleware],
    })
    class WithComp {}
    const state = (getGraphMetadata(WithComp) as any).state as StateSchema<any>;
    expect(Object.keys(state.fields)).toContain("summary");
  });

  it("does not add a summary channel otherwise", () => {
    @LangGraphAgent({
      name: "noComp",
      state: new StateSchema({ messages: MessagesValue }),
      model: MODEL,
    })
    class NoComp {}
    const state = (getGraphMetadata(NoComp) as any).state as StateSchema<any>;
    expect(Object.keys(state.fields)).not.toContain("summary");
  });

  it("composes with responseFormat: both outcome and summary are present", () => {
    @LangGraphAgent({
      name: "withCompAndResponse",
      state: new StateSchema({ messages: MessagesValue }),
      model: MODEL,
      middleware: [CompactionMiddleware],
      responseFormat: new StateSchema({}),
    })
    class WithCompAndResponse {}
    const state = (getGraphMetadata(WithCompAndResponse) as any)
      .state as StateSchema<any>;
    expect(Object.keys(state.fields)).toContain("summary");
    expect(Object.keys(state.fields)).toContain("outcome");
  });
});
