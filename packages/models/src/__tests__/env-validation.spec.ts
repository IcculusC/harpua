import { buildChatModel } from "../model-factory";
import type { Registration } from "../interfaces";

const reg: Registration = { name: "default", envPrefix: "" };

describe("env validation (superRefine + enum)", () => {
  it("openrouter without a model fails fast, naming the variable", () => {
    expect(() =>
      buildChatModel(reg, { MODEL_PROVIDER: "openrouter" }),
    ).toThrow(/OPENROUTER_MODEL is required when MODEL_PROVIDER=openrouter/);
  });

  it("ollama without a model fails fast", () => {
    expect(() => buildChatModel(reg, { MODEL_PROVIDER: "ollama" })).toThrow(
      /OLLAMA_MODEL is required when MODEL_PROVIDER=ollama/,
    );
  });

  it("openai-compatible without a base url fails fast", () => {
    expect(() =>
      buildChatModel(reg, {
        MODEL_PROVIDER: "openai-compatible",
        OPENAI_COMPATIBLE_MODEL: "m",
      }),
    ).toThrow(/OPENAI_COMPATIBLE_BASE_URL is required/);
  });

  it("openai-compatible without a model fails fast", () => {
    expect(() =>
      buildChatModel(reg, {
        MODEL_PROVIDER: "openai-compatible",
        OPENAI_COMPATIBLE_BASE_URL: "http://x/v1",
      }),
    ).toThrow(/OPENAI_COMPATIBLE_MODEL is required/);
  });

  it("an unknown provider errors, and the message names the valid arms", () => {
    expect(() =>
      buildChatModel(reg, { MODEL_PROVIDER: "gpt5-magic" }),
    ).toThrow(/mock.*openrouter.*ollama.*openai-compatible/s);
  });

  it("respects the prefix when naming the offending variable (named model)", () => {
    const fast: Registration = { name: "fast", envPrefix: "FAST_" };
    expect(() =>
      buildChatModel(fast, { FAST_MODEL_PROVIDER: "openrouter" }),
    ).toThrow(/FAST_OPENROUTER_MODEL is required/);
  });
});
