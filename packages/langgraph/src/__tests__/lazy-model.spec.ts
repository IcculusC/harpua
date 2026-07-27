import { lazyModel, LazyModel, isLazyModel } from "../lazy-model";

class SomeChatModelClass {}

describe("lazyModel marker", () => {
  it("wraps a token in a LazyModel carrying it", () => {
    const token = Symbol.for("ChatModel:fast");
    const lazy = lazyModel(token);
    expect(lazy).toBeInstanceOf(LazyModel);
    expect(lazy.token).toBe(token);
  });

  it("isLazyModel is true only for a lazyModel result", () => {
    expect(isLazyModel(lazyModel(Symbol.for("x")))).toBe(true);
    expect(isLazyModel(lazyModel("CHAT_MODEL"))).toBe(true);
    expect(isLazyModel(lazyModel(SomeChatModelClass))).toBe(true);
  });

  it("isLazyModel is false for a bare token, class, function, string, or nullish", () => {
    expect(isLazyModel(Symbol.for("x"))).toBe(false);
    expect(isLazyModel(SomeChatModelClass)).toBe(false); // a class IS a valid bare token
    expect(isLazyModel(() => undefined)).toBe(false);
    expect(isLazyModel("CHAT_MODEL")).toBe(false);
    expect(isLazyModel(null)).toBe(false);
    expect(isLazyModel(undefined)).toBe(false);
    expect(isLazyModel({ token: Symbol.for("x") })).toBe(false); // look-alike, not branded
  });
});
