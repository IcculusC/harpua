import { Logger } from "@nestjs/common";

import { buildChatModel } from "../model-factory";
import type { Registration } from "../interfaces";

const defaultReg = (defaults?: Registration["defaults"]): Registration => ({
  name: "default",
  envPrefix: "",
  defaults,
});

/**
 * Boot visibility: every resolved registration logs one line via Nest's Logger
 * (context "ChatModelModule") naming the active arm and, for a real arm, the
 * concrete model id. This is the DX fix — flipping env is never silent. Secrets
 * (api keys, credentialed base urls) must never appear.
 */
describe("model resolution boot log", () => {
  let logSpy: jest.SpyInstance;

  beforeEach(() => {
    logSpy = jest.spyOn(Logger.prototype, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    logSpy.mockRestore();
  });

  it('logs the mock arm as built-in for the default model', () => {
    buildChatModel(defaultReg(), {});
    expect(logSpy).toHaveBeenCalledWith('model "default" -> mock (built-in)');
  });

  it("logs a custom mock arm when a mockModel factory is supplied", () => {
    buildChatModel(defaultReg({ mockModel: () => buildChatModel(defaultReg(), {}) }), {});
    expect(logSpy).toHaveBeenCalledWith('model "default" -> mock (custom)');
  });

  it("logs the openrouter arm with its concrete model id, never the key", () => {
    buildChatModel(
      { name: "fast", envPrefix: "FAST_", defaults: undefined },
      {
        FAST_MODEL_PROVIDER: "openrouter",
        FAST_OPENROUTER_MODEL: "deepseek/deepseek-v4-flash",
        FAST_OPENROUTER_API_KEY: "sk-or-secret",
      },
    );
    expect(logSpy).toHaveBeenCalledWith(
      'model "fast" -> openrouter (deepseek/deepseek-v4-flash)',
    );
    // No secret ever reaches the log.
    const logged = logSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(logged).not.toContain("sk-or-secret");
  });

  it("logs the ollama arm with its model id and never the base url", () => {
    buildChatModel(defaultReg(), {
      MODEL_PROVIDER: "ollama",
      OLLAMA_MODEL: "llama3.1",
      OLLAMA_BASE_URL: "http://ollama.internal:11434",
    });
    expect(logSpy).toHaveBeenCalledWith('model "default" -> ollama (llama3.1)');
    const logged = logSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(logged).not.toContain("ollama.internal");
  });
});
