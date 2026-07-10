import { buildChatModel } from "../model-factory";
import type { Registration } from "../interfaces";

const defaultReg = (defaults?: Registration["defaults"]): Registration => ({
  name: "default",
  envPrefix: "",
  defaults,
});

describe("openrouter arm", () => {
  it("constructs ChatOpenRouter with model + api key from env", () => {
    const model: any = buildChatModel(defaultReg(), {
      MODEL_PROVIDER: "openrouter",
      OPENROUTER_MODEL: "anthropic/claude-sonnet-4.5",
      OPENROUTER_API_KEY: "sk-or-test",
    });
    expect(model._llmType()).toBe("openrouter");
    expect(model.model).toBe("anthropic/claude-sonnet-4.5");
    expect(model.apiKey).toBe("sk-or-test");
  });

  it("passes through defaults.openrouter extras (siteUrl/siteName/provider/models) and temperature", () => {
    const model: any = buildChatModel(
      defaultReg({
        temperature: 0.4,
        openrouter: {
          siteUrl: "https://example.com",
          siteName: "Example",
          provider: { order: ["anthropic"] },
          models: ["anthropic/claude-sonnet-4.5", "openai/gpt-4o-mini"],
        },
      }),
      {
        MODEL_PROVIDER: "openrouter",
        OPENROUTER_MODEL: "anthropic/claude-sonnet-4.5",
        OPENROUTER_API_KEY: "sk-or-test",
      },
    );
    expect(model.siteUrl).toBe("https://example.com");
    expect(model.siteName).toBe("Example");
    expect(model.provider).toEqual({ order: ["anthropic"] });
    expect(model.models).toEqual([
      "anthropic/claude-sonnet-4.5",
      "openai/gpt-4o-mini",
    ]);
    expect(model.temperature).toBe(0.4);
  });

  it("passes sessionId through — env beats the arm-scoped default", () => {
    const fromArm: any = buildChatModel(
      defaultReg({ openrouter: { sessionId: "arm-session" } }),
      {
        MODEL_PROVIDER: "openrouter",
        OPENROUTER_MODEL: "anthropic/claude-sonnet-4.5",
        OPENROUTER_API_KEY: "sk-or-test",
      },
    );
    expect(fromArm.sessionId).toBe("arm-session");

    const fromEnv: any = buildChatModel(
      defaultReg({ openrouter: { sessionId: "arm-session" } }),
      {
        MODEL_PROVIDER: "openrouter",
        OPENROUTER_MODEL: "anthropic/claude-sonnet-4.5",
        OPENROUTER_API_KEY: "sk-or-test",
        OPENROUTER_SESSION_ID: "env-session",
      },
    );
    expect(fromEnv.sessionId).toBe("env-session");
  });

  it("takes model from arm-scoped defaults when env omits it", () => {
    const model: any = buildChatModel(
      defaultReg({ openrouter: { model: "meta-llama/llama-3.1-8b-instruct" } }),
      { MODEL_PROVIDER: "openrouter", OPENROUTER_API_KEY: "k" },
    );
    expect(model.model).toBe("meta-llama/llama-3.1-8b-instruct");
  });

  it("env model beats defaults.openrouter.model (precedence env > defaults)", () => {
    const model: any = buildChatModel(
      defaultReg({ openrouter: { model: "from/defaults" } }),
      {
        MODEL_PROVIDER: "openrouter",
        OPENROUTER_MODEL: "from/env",
        OPENROUTER_API_KEY: "k",
      },
    );
    expect(model.model).toBe("from/env");
  });
});

describe("ollama arm", () => {
  it("constructs ChatOllama with model + default base url", () => {
    const model: any = buildChatModel(defaultReg(), {
      MODEL_PROVIDER: "ollama",
      OLLAMA_MODEL: "llama3.1",
    });
    expect(model._llmType()).toBe("ollama");
    expect(model.model).toBe("llama3.1");
    expect(model.baseUrl).toBe("http://localhost:11434");
  });

  it("uses OLLAMA_BASE_URL from env when set", () => {
    const model: any = buildChatModel(defaultReg(), {
      MODEL_PROVIDER: "ollama",
      OLLAMA_MODEL: "llama3.1",
      OLLAMA_BASE_URL: "http://ollama.internal:11434",
    });
    expect(model.baseUrl).toBe("http://ollama.internal:11434");
  });
});

describe("openai-compatible arm", () => {
  it("constructs ChatOpenAI with model, base url, and placeholder key", () => {
    const model: any = buildChatModel(defaultReg(), {
      MODEL_PROVIDER: "openai-compatible",
      OPENAI_COMPATIBLE_BASE_URL: "http://localhost:1234/v1",
      OPENAI_COMPATIBLE_MODEL: "local-model",
    });
    expect(model._llmType()).toBe("openai");
    expect(model.model).toBe("local-model");
    expect(model.clientConfig.baseURL).toBe("http://localhost:1234/v1");
    expect(model.apiKey).toBe("not-needed");
  });

  it("uses OPENAI_COMPATIBLE_API_KEY from env when set", () => {
    const model: any = buildChatModel(defaultReg(), {
      MODEL_PROVIDER: "openai-compatible",
      OPENAI_COMPATIBLE_BASE_URL: "http://localhost:1234/v1",
      OPENAI_COMPATIBLE_MODEL: "local-model",
      OPENAI_COMPATIBLE_API_KEY: "real-key",
    });
    expect(model.apiKey).toBe("real-key");
  });

  it("takes base url + model from arm-scoped defaults when env omits them", () => {
    const model: any = buildChatModel(
      defaultReg({
        openaiCompatible: {
          baseUrl: "http://defaults:1234/v1",
          model: "defaults-model",
        },
      }),
      { MODEL_PROVIDER: "openai-compatible" },
    );
    expect(model.clientConfig.baseURL).toBe("http://defaults:1234/v1");
    expect(model.model).toBe("defaults-model");
  });
});
