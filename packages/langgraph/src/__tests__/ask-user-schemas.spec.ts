import {
  askUserQuestionPresetSchema,
  normalizeAskUserPreset,
  buildAskUserEnvelopeSchema,
  askUserRequestSchema,
  askUserResumeSchema,
  resolveAskUserResume,
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

describe("askUserRequestSchema", () => {
  it("accepts the discriminated ask_user_request payload", () => {
    const parsed = askUserRequestSchema.parse({
      type: "ask_user_request",
      intro: "Before we continue:",
      questions: [{ prompt: "Continue?", inputType: "boolean" }],
    });
    expect(parsed.type).toBe("ask_user_request");
  });

  it("accepts a payload with no intro", () => {
    expect(() =>
      askUserRequestSchema.parse({
        type: "ask_user_request",
        questions: [{ prompt: "Continue?", inputType: "boolean" }],
      }),
    ).not.toThrow();
  });

  it("rejects any type other than the literal 'ask_user_request'", () => {
    expect(() =>
      askUserRequestSchema.parse({
        type: "tool_approval_request",
        questions: [],
      }),
    ).toThrow();
  });
});

describe("askUserResumeSchema", () => {
  it("accepts a positional answers resume", () => {
    const parsed = askUserResumeSchema.parse({
      answers: ["Blue", true, null, ["a", "b"]],
    });
    expect(parsed).toEqual({ answers: ["Blue", true, null, ["a", "b"]] });
  });

  it("accepts a dismissed resume with a reason", () => {
    const parsed = askUserResumeSchema.parse({
      dismissed: true,
      reason: "no user available",
    });
    expect(parsed).toEqual({ dismissed: true, reason: "no user available" });
  });

  it("accepts a dismissed resume with no reason", () => {
    expect(() => askUserResumeSchema.parse({ dismissed: true })).not.toThrow();
  });

  it("rejects a garbage shape (neither answers nor dismissed)", () => {
    expect(() => askUserResumeSchema.parse({ foo: "bar" })).toThrow();
  });
});

describe("resolveAskUserResume", () => {
  it("returns valid positional answers unchanged", () => {
    const resume = resolveAskUserResume("ask_user", 2, {
      answers: ["Blue", true],
    });
    expect(resume).toEqual({ answers: ["Blue", true] });
  });

  it("returns a valid dismissal unchanged", () => {
    const resume = resolveAskUserResume("ask_user", 2, {
      dismissed: true,
      reason: "afk",
    });
    expect(resume).toEqual({ dismissed: true, reason: "afk" });
  });

  it("throws a clear, actionable error for a garbage resume shape", () => {
    expect(() => resolveAskUserResume("ask_user", 2, { foo: "bar" })).toThrow(
      "Invalid resume value for ask_user tool 'ask_user': expected " +
        "{ answers: Array<string | string[] | boolean | null> } or " +
        '{ dismissed: true, reason?: string }, received {"foo":"bar"}.',
    );
  });

  it("throws when answers.length does not match questionCount", () => {
    expect(() =>
      resolveAskUserResume("ask_user", 2, { answers: ["only one"] }),
    ).toThrow(
      "Invalid resume value for ask_user tool 'ask_user': expected 2 " +
        "answer(s) (one per question), received 1.",
    );
  });
});
