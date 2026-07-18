import * as pkg from "../index";

describe("public exports (compaction family)", () => {
  it("exports the middleware classes and provider helpers", () => {
    for (const name of [
      "CompactionMiddleware",
      "ContextWindowMiddleware",
      "ManagedContextMiddleware",
      "provideCompaction",
      "provideContextWindow",
      "provideManagedContext",
      "clearAgentExit",
      "withCompactionState",
      "CompactionSummarySchema",
    ]) {
      expect((pkg as any)[name]).toBeDefined();
    }
  });

  it("exports compaction state helpers and symbols", () => {
    for (const name of ["needsCompactionState", "COMPACTION_STATE"]) {
      expect((pkg as any)[name]).toBeDefined();
    }
  });

  it("exports the compaction family option symbols", () => {
    for (const name of ["COMPACTION_OPTS", "CONTEXT_WINDOW_OPTS", "MANAGED_CONTEXT_OPTS"]) {
      expect((pkg as any)[name]).toBeDefined();
    }
  });

  it("does not leak internal compaction helpers", () => {
    for (const name of [
      "computeFold",
      "buildCompactionSignal",
      "resolveTrigger",
      "translateCacheMarkers",
      "markCacheBoundary",
      "assembleWindow",
      "evictOldToolOutputs",
      "summarizeSpan",
      "renderSummary",
    ]) {
      expect((pkg as any)[name]).toBeUndefined();
    }
  });
});

describe("public exports (ask_user tool family)", () => {
  it("exports the factory and the preset schema", () => {
    for (const name of ["askUserTool", "askUserQuestionPresetSchema"]) {
      expect((pkg as any)[name]).toBeDefined();
    }
  });

  it("does not leak internal ask_user helpers", () => {
    for (const name of [
      "normalizeAskUserPreset",
      "resolveAskUserResume",
      "defaultSerializeAnswers",
      "buildAskUserEnvelopeSchema",
      "askUserResumeSchema",
      "askUserAnswersResumeSchema",
      "askUserDismissedResumeSchema",
      "askUserRequestSchema",
      "askUserToolOptionsSchema",
      "resolveAskUserToolOptions",
    ]) {
      expect((pkg as any)[name]).toBeUndefined();
    }
  });
});
