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
});
