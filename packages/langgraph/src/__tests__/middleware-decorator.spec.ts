import {
  LangGraphMiddleware,
  isMiddlewareClass,
  normalizeMiddleware,
} from "../middleware/middleware.decorator";

@LangGraphMiddleware()
class MyMw {
  async beforeModel() {}
}

class Plain {}

describe("@LangGraphMiddleware", () => {
  it("marks a class as middleware and applies Injectable", () => {
    expect(isMiddlewareClass(MyMw)).toBe(true);
    expect(isMiddlewareClass(Plain)).toBe(false);
    // @Injectable metadata present:
    expect(Reflect.getMetadata("__injectable__", MyMw) ?? true).toBeTruthy();
  });

  it("normalizes bare and targeted entries", () => {
    expect(normalizeMiddleware(MyMw)).toEqual({ use: MyMw });
    expect(normalizeMiddleware({ use: MyMw, on: Plain })).toEqual({
      use: MyMw,
      on: Plain,
    });
  });
});
