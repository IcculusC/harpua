import { webResearchTools } from "../web-research/web-research-tools";
import { fileExplorationTools } from "../file-exploration/file-exploration-tools";
import type { FetchFn, FetchResponseLike } from "../web-research/options";
import { makeTmpDir, removeTmpDir, runTool } from "./tmp-tree";

const FIXED_NOW = () => new Date("2026-07-08T12:00:00Z");

const PAGE =
  "<html><head><title>LM317 Page</title></head>" +
  "<body><h1>LM317</h1><p>Dropout voltage 1.5 V typical.</p></body></html>";

function fetchFor(searchBody: unknown): FetchFn {
  return async (url: string): Promise<FetchResponseLike> => {
    const isSearch = url.includes("/search?");
    return {
      ok: true,
      status: 200,
      headers: {
        get: (name: string) =>
          name.toLowerCase() === "content-type"
            ? isSearch
              ? "application/json"
              : "text/html"
            : null,
      },
      text: async () => (isSearch ? JSON.stringify(searchBody) : PAGE),
    };
  };
}

describe("webResearchTools bundle", () => {
  let dir: string;
  beforeEach(() => (dir = makeTmpDir()));
  afterEach(() => removeTmpDir(dir));

  it("returns web_search and fetch_url sharing one options object", async () => {
    const tools = webResearchTools({
      baseUrl: "http://searx.local",
      saveDir: dir,
      fetchFn: fetchFor({
        results: [{ title: "LM317", url: "https://ti.com/lm317" }],
      }),
      now: FIXED_NOW,
    });
    expect(tools.map((t) => t.name)).toEqual(["web_search", "fetch_url"]);

    const searchOut = await runTool(tools[0], { query: "LM317" });
    expect(searchOut).toContain("https://ti.com/lm317");

    const fetchOut = await runTool(tools[1], { url: "https://ti.com/lm317" });
    expect(fetchOut).toContain("LM317 Page");
  });

  it("rejects unknown keys and missing required options", () => {
    expect(() =>
      webResearchTools({ baseUrl: "http://x" } as never),
    ).toThrow();
    expect(() =>
      webResearchTools({
        baseUrl: "http://x",
        saveDir: "/tmp/x",
        bogus: 1,
      } as never),
    ).toThrow();
  });

  it("closes the loop: a fetched page is findable with fileExplorationTools", async () => {
    const tools = webResearchTools({
      baseUrl: "http://searx.local",
      saveDir: dir,
      fetchFn: fetchFor({ results: [] }),
      now: FIXED_NOW,
    });
    await runTool(tools[1], { url: "https://ti.com/lm317" });

    const [searchFiles] = fileExplorationTools({ root: dir });
    const found = await runTool(searchFiles, { pattern: "Dropout voltage" });
    expect(found).toContain("Dropout voltage 1.5 V typical.");
    expect(found).toMatch(/\.md/);
  });
});
