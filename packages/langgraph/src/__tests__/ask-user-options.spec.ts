import { z } from "zod";
import {
  askUserToolOptionsSchema,
  resolveAskUserToolOptions,
  DEFAULT_ASK_USER_NAME,
  DEFAULT_ASK_USER_DESCRIPTION,
  DEFAULT_DISMISSED_MESSAGE,
} from "../tools/ask-user/options";

describe("askUserToolOptionsSchema / resolveAskUserToolOptions", () => {
  it("defaults name, description, maxQuestions, and dismissedMessage", () => {
    const resolved = resolveAskUserToolOptions();
    expect(resolved.name).toBe(DEFAULT_ASK_USER_NAME);
    expect(resolved.description).toBe(DEFAULT_ASK_USER_DESCRIPTION);
    expect(resolved.maxQuestions).toBe(8);
    expect(resolved.dismissedMessage).toBe(DEFAULT_DISMISSED_MESSAGE);
    expect(resolved.questionSchema).toBeUndefined();
    expect(resolved.serializeAnswers).toBeUndefined();
  });

  it("accepts caller overrides for every field", () => {
    const customSchema = z.object({ prompt: z.string() });
    const serialize = () => "custom";
    const resolved = resolveAskUserToolOptions({
      name: "ask_the_human",
      description: "Custom description.",
      maxQuestions: 3,
      questionSchema: customSchema,
      serializeAnswers: serialize,
      dismissedMessage: "Custom dismissal.",
    });
    expect(resolved).toEqual({
      name: "ask_the_human",
      description: "Custom description.",
      maxQuestions: 3,
      questionSchema: customSchema,
      serializeAnswers: serialize,
      dismissedMessage: "Custom dismissal.",
    });
  });

  it("rejects a questionSchema that isn't a zod schema", () => {
    expect(() =>
      askUserToolOptionsSchema.parse({ questionSchema: { fake: true } }),
    ).toThrow();
  });

  it("rejects a serializeAnswers that isn't a function", () => {
    expect(() =>
      askUserToolOptionsSchema.parse({ serializeAnswers: "nope" }),
    ).toThrow();
  });

  it("rejects an empty name", () => {
    expect(() => askUserToolOptionsSchema.parse({ name: "" })).toThrow();
  });

  it("rejects unknown top-level keys (strict)", () => {
    expect(() => askUserToolOptionsSchema.parse({ bogus: true })).toThrow();
  });
});
