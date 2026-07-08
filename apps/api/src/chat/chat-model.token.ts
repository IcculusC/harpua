/**
 * DI token for the ChatGraph's tool-bound chat model. `provideGraphBoundModel`
 * (in chat.module.ts) publishes `CHAT_MODEL.bindTools(ChatGraph's tools)` under
 * this token so the model can actually emit the `lookup_order` tool call the
 * graph's ToolNode executes. `CallModelNode` injects it.
 */
export const CHAT_BOUND_MODEL = Symbol.for("@harpua/api:CHAT_BOUND_MODEL");
