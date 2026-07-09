import type { FetchFn, FetchResponseLike } from "../web-research/options";
import { fetchUrlTool } from "../web-research/fetch-url";
import { searchKnowledgeTool } from "../knowledge/search-knowledge";
import { makeTmpDir, removeTmpDir, runTool } from "./tmp-tree";

const FIXED_NOW = () => new Date("2026-07-09T12:00:00Z");

const PAGE =
  "<html><head><title>LM317 Product Page</title></head><body>" +
  "<h1>LM317</h1><h2>Electrical Characteristics</h2>" +
  "<p>Dropout voltage 1.5 V typical at 1 A load current.</p>" +
  "<h2>Ordering</h2><p>Available in TO-220 and SOT-223 packages.</p>" +
  "</body></html>";

const htmlFetch: FetchFn = async (): Promise<FetchResponseLike> => ({
  ok: true,
  status: 200,
  headers: { get: (n: string) => (n.toLowerCase() === "content-type" ? "text/html" : null) },
  text: async () => PAGE,
});

describe("web-research → knowledge loop", () => {
  let dir: string;
  beforeEach(() => (dir = makeTmpDir()));
  afterEach(() => removeTmpDir(dir));

  it("finds content from a fetch_url-saved page with true provenance", async () => {
    await runTool(fetchUrlTool({ saveDir: dir, fetchFn: htmlFetch, now: FIXED_NOW }), {
      url: "https://ti.com/lm317",
    });

    const out = await runTool(searchKnowledgeTool({ root: dir }), {
      query: "what is the dropout voltage at 1 A?",
    });

    expect(out).toContain("Dropout voltage 1.5 V typical");
    expect(out).toMatch(/lm317-product-page-[0-9a-f]{8}\.md:\d+-\d+/);
    expect(out).toContain("Electrical Characteristics");
  });
});
