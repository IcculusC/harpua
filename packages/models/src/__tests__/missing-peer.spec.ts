import { buildChatModel } from "../model-factory";
import * as optionalRequire from "../optional-require";
import type { Registration } from "../interfaces";

const reg: Registration = { name: "default", envPrefix: "" };

/** Simulate the optional peer not being installed. */
function stubMissing(pkg: string): jest.SpyInstance {
  return jest
    .spyOn(optionalRequire, "requireOptionalModule")
    .mockImplementation((name: string) => {
      if (name === pkg) {
        const err = new Error(`Cannot find module '${pkg}'`) as NodeJS.ErrnoException;
        err.code = "MODULE_NOT_FOUND";
        throw err;
      }
      return jest.requireActual(name);
    });
}

afterEach(() => jest.restoreAllMocks());

describe("missing optional peer → actionable install hint", () => {
  it("openrouter arm names the package and the pnpm add command", () => {
    stubMissing("@langchain/openrouter");
    expect(() =>
      buildChatModel(reg, {
        MODEL_PROVIDER: "openrouter",
        OPENROUTER_MODEL: "anthropic/claude-sonnet-4.5",
        OPENROUTER_API_KEY: "k",
      }),
    ).toThrow(/optional peer '@langchain\/openrouter'[\s\S]*pnpm add @langchain\/openrouter/);
  });

  it("ollama arm names its package", () => {
    stubMissing("@langchain/ollama");
    expect(() =>
      buildChatModel(reg, { MODEL_PROVIDER: "ollama", OLLAMA_MODEL: "llama3.1" }),
    ).toThrow(/pnpm add @langchain\/ollama/);
  });

  it("openai-compatible arm names its package", () => {
    stubMissing("@langchain/openai");
    expect(() =>
      buildChatModel(reg, {
        MODEL_PROVIDER: "openai-compatible",
        OPENAI_COMPATIBLE_BASE_URL: "http://x/v1",
        OPENAI_COMPATIBLE_MODEL: "m",
      }),
    ).toThrow(/pnpm add @langchain\/openai/);
  });
});
