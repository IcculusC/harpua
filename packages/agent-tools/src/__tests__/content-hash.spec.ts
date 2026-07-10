import { contentHash } from "../knowledge/content-hash";

describe("contentHash", () => {
  it("is stable for byte-identical text", () => {
    expect(contentHash("hello world")).toBe(contentHash("hello world"));
  });

  it("differs for different text", () => {
    expect(contentHash("a")).not.toBe(contentHash("b"));
  });

  it("is a 16-char lowercase hex string", () => {
    expect(contentHash("anything at all")).toMatch(/^[0-9a-f]{16}$/);
  });
});
