import { SystemMessage } from "@langchain/core/messages";
import { SystemPrompt } from "./system-prompt";

describe("SystemPrompt", () => {
  const originalLanguage = process.env.CHAT_LANGUAGE;

  afterEach(() => {
    if (originalLanguage === undefined) delete process.env.CHAT_LANGUAGE;
    else process.env.CHAT_LANGUAGE = originalLanguage;
  });

  it("defaults to English", () => {
    delete process.env.CHAT_LANGUAGE;
    const message = new SystemPrompt().asMessage();
    expect(message).toBeInstanceOf(SystemMessage);
    expect(message.content).toContain("Always respond in English.");
  });

  it("renders a language tag as its display name", () => {
    process.env.CHAT_LANGUAGE = "es";
    expect(new SystemPrompt().asMessage().content).toContain(
      "Always respond in Spanish.",
    );
  });

  it("accepts region subtags", () => {
    process.env.CHAT_LANGUAGE = "pt-BR";
    expect(new SystemPrompt().asMessage().content).toContain(
      "Always respond in Brazilian Portuguese.",
    );
  });

  it("rejects a malformed tag at construction", () => {
    process.env.CHAT_LANGUAGE = "not a language!";
    expect(() => new SystemPrompt()).toThrow(/CHAT_LANGUAGE/);
  });
});
