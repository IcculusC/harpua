import { AIMessage } from "@langchain/core/messages";
import { describe, expect, it } from "vitest";

import { requireOptionalModule } from "../optional-require.js";

describe("optional-require", () => {
  it("loads peers as the same ESM instance the app imports (no CJS copy of core)", () => {
    const core = requireOptionalModule("@langchain/core/messages") as {
      AIMessage: typeof AIMessage;
    };
    expect(core.AIMessage).toBe(AIMessage);
  });

  it("throws a module-not-found code for a missing peer", () => {
    expect(() => requireOptionalModule("@harpua/definitely-not-installed")).toThrow(
      expect.objectContaining({ code: "ERR_MODULE_NOT_FOUND" }),
    );
  });

  it("loads a real provider peer synchronously", () => {
    const mod = requireOptionalModule("@langchain/openai") as { ChatOpenAI: unknown };
    expect(typeof mod.ChatOpenAI).toBe("function");
  });
});
