import { HumanMessage } from "@langchain/core/messages";
import { CACHE_BOUNDARY, markCacheBoundary, translateCacheMarkers } from "../middleware/cache-markers";

describe("cache-markers", () => {
  it("marks a boundary in additional_kwargs", () => {
    const m = new HumanMessage("x");
    markCacheBoundary(m);
    expect((m.additional_kwargs as any)[CACHE_BOUNDARY]).toBe(true);
  });

  it("translates markers to cache_control for anthropic", () => {
    const m = new HumanMessage("x");
    markCacheBoundary(m);
    const [out] = translateCacheMarkers([m], "anthropic");
    expect((out.additional_kwargs as any).cache_control).toEqual({ type: "ephemeral" });
    expect((out.additional_kwargs as any)[CACHE_BOUNDARY]).toBeUndefined();
  });

  it("strips markers for non-explicit providers", () => {
    const m = new HumanMessage("x");
    markCacheBoundary(m);
    const [out] = translateCacheMarkers([m], "openai");
    expect((out.additional_kwargs as any)[CACHE_BOUNDARY]).toBeUndefined();
    expect((out.additional_kwargs as any).cache_control).toBeUndefined();
  });

  it("does not mutate the input message (copy-on-write)", () => {
    const m = new HumanMessage("x");
    markCacheBoundary(m);
    const [out] = translateCacheMarkers([m], "anthropic");
    // Original is untouched: still marked, no cache_control leaked back in.
    expect((m.additional_kwargs as any)[CACHE_BOUNDARY]).toBe(true);
    expect((m.additional_kwargs as any).cache_control).toBeUndefined();
    // The translated result is a distinct object.
    expect(out).not.toBe(m);
  });

  it("does not leak cache_control across providers when a message is reused", () => {
    const m = new HumanMessage("x");
    markCacheBoundary(m);
    const [anthropicOut] = translateCacheMarkers([m], "anthropic");
    expect((anthropicOut.additional_kwargs as any).cache_control).toEqual({ type: "ephemeral" });
    // Same source message, different provider: no stale cache_control carried over.
    const [openaiOut] = translateCacheMarkers([m], "openai");
    expect((openaiOut.additional_kwargs as any).cache_control).toBeUndefined();
    expect((openaiOut.additional_kwargs as any)[CACHE_BOUNDARY]).toBeUndefined();
  });

  it("passes unmarked messages through unchanged (same reference)", () => {
    const m = new HumanMessage("x");
    const [out] = translateCacheMarkers([m], "anthropic");
    expect(out).toBe(m);
  });

  it("strips markers for an unknown llmType", () => {
    const m = new HumanMessage("x");
    markCacheBoundary(m);
    const [out] = translateCacheMarkers([m], "harpua-scripted-fake");
    expect((out.additional_kwargs as any)[CACHE_BOUNDARY]).toBeUndefined();
    expect((out.additional_kwargs as any).cache_control).toBeUndefined();
  });
});
