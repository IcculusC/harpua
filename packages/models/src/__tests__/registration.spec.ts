import { Test } from "@nestjs/testing";

import { ChatModelModule } from "../chat-model.module";
import { envPrefixOf, resetChatModelRegistry } from "../registry";
import { stubEnv } from "./env-fixture";

beforeEach(() => resetChatModelRegistry());

describe("registration bootstrap invariants", () => {
  it("register() without forRoot() fails Nest DI, naming the options token", async () => {
    // The ordering invariant is enforced through the DI graph: the register()d
    // provider injects CHAT_MODEL_MODULE_OPTIONS, which only forRoot() provides.
    const { restore } = stubEnv({ FAST_MODEL_PROVIDER: "mock" });
    try {
      await expect(
        Test.createTestingModule({
          imports: [ChatModelModule.register({ name: "fast" })],
        }).compile(),
      ).rejects.toThrow(/resolve dependencies[\s\S]*MODULE_OPTIONS/);
    } finally {
      restore();
    }
  });

  it("register() after forRoot() succeeds", () => {
    ChatModelModule.forRoot();
    expect(() => ChatModelModule.register({ name: "fast" })).not.toThrow();
  });

  it("duplicate names throw a bootstrap error", () => {
    ChatModelModule.forRoot();
    ChatModelModule.register({ name: "fast" });
    expect(() => ChatModelModule.register({ name: "fast" })).toThrow(
      /duplicate chat model registration "fast"/,
    );
  });

  it('registering "default" collides with forRoot (reserved)', () => {
    ChatModelModule.forRoot();
    expect(() => ChatModelModule.register({ name: "default" })).toThrow(
      /duplicate chat model registration "default"/,
    );
  });

  it("an invalid name slug throws", () => {
    ChatModelModule.forRoot();
    expect(() => ChatModelModule.register({ name: "Fast Model" })).toThrow(
      /lowercase slug/,
    );
    expect(() => ChatModelModule.register({ name: "1st" })).toThrow(
      /lowercase slug/,
    );
  });

  it("a second forRoot() in the same process throws, naming the reset helper", () => {
    ChatModelModule.forRoot();
    expect(() => ChatModelModule.forRoot()).toThrow(
      /forRoot\(\) was called more than once[\s\S]*resetChatModelRegistry\(\)/,
    );
  });

  it("resetChatModelRegistry() allows a fresh forRoot() (fresh slate per app)", () => {
    ChatModelModule.forRoot();
    ChatModelModule.register({ name: "fast" });
    resetChatModelRegistry();
    // A fresh boot: forRoot succeeds again and "fast" is free once more.
    expect(() => ChatModelModule.forRoot()).not.toThrow();
    expect(() => ChatModelModule.register({ name: "fast" })).not.toThrow();
  });
});

describe("envPrefixOf", () => {
  it("SCREAMING_SNAKEs the slug with a trailing underscore", () => {
    expect(envPrefixOf("fast")).toBe("FAST_");
    expect(envPrefixOf("smart")).toBe("SMART_");
    expect(envPrefixOf("my-model")).toBe("MY_MODEL_");
  });
});
