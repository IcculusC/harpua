import {
  askUserQuestionPresetSchema,
  normalizeAskUserPreset,
  buildAskUserEnvelopeSchema,
  type AskUserQuestionPreset,
} from "../tools/ask-user/schemas";

describe("askUserQuestionPresetSchema", () => {
  it("accepts a minimal boolean question", () => {
    const parsed = askUserQuestionPresetSchema.parse({
      prompt: "Continue?",
      inputType: "boolean",
    });
    expect(parsed).toEqual({ prompt: "Continue?", inputType: "boolean" });
  });

  it("rejects an empty prompt", () => {
    expect(() =>
      askUserQuestionPresetSchema.parse({ prompt: "", inputType: "boolean" }),
    ).toThrow();
  });

  it("rejects an inputType outside the enum", () => {
    expect(() =>
      askUserQuestionPresetSchema.parse({ prompt: "x", inputType: "textarea" }),
    ).toThrow();
  });

  it("rejects unknown top-level keys (strict)", () => {
    expect(() =>
      askUserQuestionPresetSchema.parse({
        prompt: "x",
        inputType: "boolean",
        extra: 1,
      }),
    ).toThrow();
  });
});

describe("normalizeAskUserPreset", () => {
  it("trims, drops empties, and dedupes select options", () => {
    const result = normalizeAskUserPreset({
      prompt: "Pick a color",
      inputType: "select",
      options: ["Red", " Red ", "Blue", "  ", "Green"],
    });
    expect(result).toEqual({
      prompt: "Pick a color",
      inputType: "select",
      options: ["Red", "Blue", "Green"],
    });
  });

  it("coerces select to free_text when fewer than 2 options survive", () => {
    const result = normalizeAskUserPreset({
      prompt: "Pick one",
      inputType: "select",
      options: ["Only"],
    });
    expect(result).toEqual({ prompt: "Pick one", inputType: "free_text" });
  });

  it("coerces multi_select to free_text when all options are empty", () => {
    const result = normalizeAskUserPreset({
      prompt: "Pick any",
      inputType: "multi_select",
      options: ["  ", "   "],
    });
    expect(result).toEqual({ prompt: "Pick any", inputType: "free_text" });
  });

  it("coerces select with no options at all to free_text", () => {
    const result = normalizeAskUserPreset({
      prompt: "Pick one",
      inputType: "select",
    });
    expect(result).toEqual({ prompt: "Pick one", inputType: "free_text" });
  });

  it("passes boolean questions through unchanged", () => {
    const question: AskUserQuestionPreset = {
      prompt: "Continue?",
      inputType: "boolean",
    };
    expect(normalizeAskUserPreset(question)).toEqual(question);
  });

  it("passes free_text questions through unchanged", () => {
    const question: AskUserQuestionPreset = {
      prompt: "Anything else?",
      inputType: "free_text",
    };
    expect(normalizeAskUserPreset(question)).toEqual(question);
  });
});

describe("buildAskUserEnvelopeSchema", () => {
  const envelope = buildAskUserEnvelopeSchema(askUserQuestionPresetSchema, 8);

  it("accepts an envelope with intro and 1..8 questions", () => {
    const parsed = envelope.parse({
      intro: "Before we continue:",
      questions: [{ prompt: "Continue?", inputType: "boolean" }],
    });
    expect(parsed.questions).toHaveLength(1);
  });

  it("accepts an envelope with no intro", () => {
    expect(() =>
      envelope.parse({
        questions: [{ prompt: "Continue?", inputType: "boolean" }],
      }),
    ).not.toThrow();
  });

  it("rejects an empty questions array (min 1)", () => {
    expect(() => envelope.parse({ questions: [] })).toThrow();
  });

  it("rejects more than maxQuestions", () => {
    const capped = buildAskUserEnvelopeSchema(askUserQuestionPresetSchema, 1);
    expect(() =>
      capped.parse({
        questions: [
          { prompt: "A?", inputType: "boolean" },
          { prompt: "B?", inputType: "boolean" },
        ],
      }),
    ).toThrow();
  });

  it("rejects unknown top-level keys (strict)", () => {
    expect(() =>
      envelope.parse({
        questions: [{ prompt: "Continue?", inputType: "boolean" }],
        extra: true,
      }),
    ).toThrow();
  });
});
