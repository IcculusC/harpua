import { buildChatModel } from "../model-factory";
import { MockChatModel } from "../mock-chat-model";
import * as optionalRequire from "../optional-require";
import type { Registration } from "../interfaces";
import { stubEnv } from "./env-fixture";

/** A "fast" role registered with an arm-scoped OpenRouter model default. */
const fastRole: Registration = {
  name: "fast",
  envPrefix: "FAST_",
  defaults: { openrouter: { model: "deepseek/deepseek-v4-flash" } },
};

afterEach(() => jest.restoreAllMocks());

describe("named roles with arm-scoped defaults", () => {
  it("keyless boot stays sacred: a role with an OpenRouter model default boots on mock with zero env — no client constructed", () => {
    const spy = jest.spyOn(optionalRequire, "requireOptionalModule");
    const model = buildChatModel(fastRole, {});
    expect(model).toBeInstanceOf(MockChatModel);
    // The optional peer is never even required at boot.
    expect(spy).not.toHaveBeenCalled();
  });

  it("a single prefixed env var flips it real with the preset model already applied, sharing the unprefixed OPENROUTER_API_KEY", () => {
    // The lib reads the shared, unprefixed OPENROUTER_API_KEY from process.env;
    // stubEnv puts it there. Only FAST_MODEL_PROVIDER is role-specific.
    const { env, restore } = stubEnv({
      FAST_MODEL_PROVIDER: "openrouter",
      OPENROUTER_API_KEY: "sk-or-shared",
    });
    try {
      const model: any = buildChatModel(fastRole, env);
      expect(model._llmType()).toBe("openrouter");
      expect(model.model).toBe("deepseek/deepseek-v4-flash");
      expect(model.apiKey).toBe("sk-or-shared");
    } finally {
      restore();
    }
  });

  it("prefixed env model overrides the arm-scoped preset (env > defaults)", () => {
    const model: any = buildChatModel(fastRole, {
      FAST_MODEL_PROVIDER: "openrouter",
      FAST_OPENROUTER_MODEL: "openai/gpt-oss-120b",
      FAST_OPENROUTER_API_KEY: "sk-or-fast",
    });
    expect(model.model).toBe("openai/gpt-oss-120b");
    expect(model.apiKey).toBe("sk-or-fast");
  });

  it("the arm-scoped default is inert for a different arm (a deepseek slug never leaks to ollama)", () => {
    // Choosing ollama with no OLLAMA_MODEL must fail — the openrouter.model
    // default does NOT satisfy the ollama arm.
    expect(() =>
      buildChatModel(fastRole, { FAST_MODEL_PROVIDER: "ollama" }),
    ).toThrow(/FAST_OLLAMA_MODEL is required/);
  });
});
