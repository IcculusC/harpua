import "reflect-metadata";

// Scripted / rule-based chat models.
export {
  scriptedModel,
  ruleModel,
  ScriptedModelBuilder,
  RuleModelBuilder,
  ToolCallSpec,
  textOf,
} from "./scripted-model";
export type { ScriptedChatModel, RuleResult } from "./scripted-model";

// Stream collectors.
export { collectStream, collectUntilInterrupt } from "./stream-collectors";
export type { CollectedUntilInterrupt } from "./stream-collectors";

// Interrupt helpers.
export { expectInterrupt } from "./interrupt-helpers";

// Test module builder.
export { createGraphTestingModule } from "./testing-module";
export type {
  GraphTestingModuleConfig,
  GraphTestingHarness,
} from "./testing-module";

// Fixed clock provider.
export { CLOCK, fixedClock, provideFixedClock } from "./clock";
export type { Clock } from "./clock";
