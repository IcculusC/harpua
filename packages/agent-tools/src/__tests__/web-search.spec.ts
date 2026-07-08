import { webSearchTool } from "../web-research/web-search";
import type { FetchFn, FetchResponseLike } from "../web-research/options";
import { runTool } from "./tmp-tree";

function jsonResponse(body: unknown, status = 200): FetchResponseLike {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => "application/json" },
    text: async () => JSON.stringify(body),
  };
}

const THREE_RESULTS = {
  results: [
    { title: "LM317 datasheet", url: "https://ti.com/lm317", content: "Adjustable regulator." },
    { title: "LM317 calculator", url: "https://example.com/calc" },
    { title: "LM317 thread", url: "https://forum.example.com/t/1", content: "Use 240R." },
  ],
};

describe("web_search", () => {
  it("formats a numbered list with title, url, and snippet when present", async () => {
    const fetchFn: FetchFn = async () => jsonResponse(THREE_RESULTS);
    const tool = webSearchTool({ baseUrl: "http://searx.local", fetchFn });
    const out = await runTool(tool, { query: "LM317" });
    expect(out).toContain("1. LM317 datasheet");
    expect(out).toContain("https://ti.com/lm317");
    expect(out).toContain("Adjustable regulator.");
    expect(out).toContain("2. LM317 calculator");
    expect(out).toContain("3. LM317 thread");
  });

  it("caps results at maxResults and URL-encodes the query", async () => {
    const seen: string[] = [];
    const fetchFn: FetchFn = async (url) => {
      seen.push(url);
      return jsonResponse(THREE_RESULTS);
    };
    const tool = webSearchTool({ baseUrl: "http://searx.local", maxResults: 2, fetchFn });
    const out = await runTool(tool, { query: "LM317 dropout & load" });
    expect(out).toContain("2. LM317 calculator");
    expect(out).not.toContain("3. LM317 thread");
    expect(seen[0]).toBe(
      "http://searx.local/search?q=LM317%20dropout%20%26%20load&format=json",
    );
  });

  it("strips a trailing slash from baseUrl", async () => {
    const seen: string[] = [];
    const fetchFn: FetchFn = async (url) => {
      seen.push(url);
      return jsonResponse({ results: [] });
    };
    await runTool(webSearchTool({ baseUrl: "http://searx.local/", fetchFn }), {
      query: "x",
    });
    expect(seen[0]).toContain("http://searx.local/search?");
  });

  it("returns a friendly message for zero results", async () => {
    const fetchFn: FetchFn = async () => jsonResponse({ results: [] });
    const out = await runTool(
      webSearchTool({ baseUrl: "http://searx.local", fetchFn }),
      { query: "xyzzy" },
    );
    expect(out).toMatch(/no results/i);
    expect(out).toContain("xyzzy");
  });

  it("reports non-2xx statuses with the JSON-format hint, without throwing", async () => {
    const fetchFn: FetchFn = async () => jsonResponse({}, 403);
    const out = await runTool(
      webSearchTool({ baseUrl: "http://searx.local", fetchFn }),
      { query: "x" },
    );
    expect(out).toContain("403");
    expect(out).toMatch(/settings\.yml/);
  });

  it("reports network failures and unparseable bodies as strings", async () => {
    const failing: FetchFn = async () => {
      throw new Error("connect ECONNREFUSED");
    };
    const badBody: FetchFn = async () => ({
      ok: true,
      status: 200,
      headers: { get: () => "text/html" },
      text: async () => "<html>not json</html>",
    });
    const out1 = await runTool(
      webSearchTool({ baseUrl: "http://searx.local", fetchFn: failing }),
      { query: "x" },
    );
    const out2 = await runTool(
      webSearchTool({ baseUrl: "http://searx.local", fetchFn: badBody }),
      { query: "x" },
    );
    expect(out1).toContain("ECONNREFUSED");
    expect(out2).toMatch(/unexpected response/i);
  });
});
