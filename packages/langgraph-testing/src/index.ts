import "reflect-metadata";

// Scripted / rule-based chat models.
export {
  scriptedModel,
  ruleModel,
  ScriptedModelBuilder,
  RuleModelBuilder,
  ToolCallSpec,
  textOf,
} from "./scripted-model.js";
export type {
  FakeChatModel,
  ScriptedChatModel,
  RuleResult,
} from "./scripted-model.js";
export type { UsageMetadata } from "@langchain/core/messages";

// Stream collectors.
export { collectStream, collectUntilInterrupt } from "./stream-collectors.js";
export type { CollectedUntilInterrupt } from "./stream-collectors.js";

// Interrupt helpers.
export { expectInterrupt } from "./interrupt-helpers.js";

// Test module builder.
export { createGraphTestingModule } from "./testing-module.js";
export type {
  GraphTestingModuleConfig,
  GraphTestingHarness,
} from "./testing-module.js";

// Fixed clock provider.
export { CLOCK, fixedClock, provideFixedClock } from "./clock.js";
export type { Clock } from "./clock.js";
