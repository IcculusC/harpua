import fs from "node:fs";
import path from "node:path";

import type { RunnableConfig } from "@langchain/core/runnables";

import { fetchUrlTool } from "../web-research/fetch-url";
import type { FetchFn, FetchResponseLike } from "../web-research/options";
import { makeTmpDir, removeTmpDir, runTool } from "./tmp-tree";

const FIXED_NOW = () => new Date("2026-07-08T12:00:00Z");

function response(
  body: string,
  contentType: string,
  status = 200,
  contentLength?: number,
): FetchResponseLike {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get: (name: string) => {
        const key = name.toLowerCase();
        if (key === "content-type") return contentType;
        if (key === "content-length" && contentLength !== undefined) {
          return String(contentLength);
        }
        return null;
      },
    },
    text: async () => body,
  };
}

const PAGE =
  "<html><head><title>LM317 Product Page</title></head>" +
  "<body><h1>LM317</h1><p>Dropout voltage 1.5 V typical.</p></body></html>";

describe("fetch_url", () => {
  let dir: string;
  beforeEach(() => (dir = makeTmpDir()));
  afterEach(() => removeTmpDir(dir));

  const htmlFetch: FetchFn = async () => response(PAGE, "text/html; charset=utf-8");

  it("saves an HTML page as markdown with frontmatter and reports the path", async () => {
    const tool = fetchUrlTool({ saveDir: dir, fetchFn: htmlFetch, now: FIXED_NOW });
    const out = await runTool(tool, { url: "https://ti.com/lm317" });

    expect(out).toContain("LM317 Product Page");
    expect(out).toMatch(/search_files|read_lines/);

    const files = fs.readdirSync(dir);
    expect(files).toHaveLength(1);
    // The confirmation must name the file the way the file-exploration
    // tools (jailed to this same directory) address it: BARE filename. A
    // cwd-relative path double-resolves inside the jail ("sources/sources/x")
    // and the model faithfully echoes whatever this message teaches it.
    expect(out).toContain(`as ${files[0]}.`);
    expect(out).not.toContain(dir);
    const content = fs.readFileSync(path.join(dir, files[0]), "utf8");
    expect(content).toContain("url: https://ti.com/lm317");
    expect(content).toContain("fetched: 2026-07-08");
    expect(content).toContain("# LM317");
    expect(content).toContain("Dropout voltage 1.5 V typical.");
  });

  it("saves text/plain bodies as-is", async () => {
    const plainFetch: FetchFn = async () => response("just text", "text/plain");
    await runTool(
      fetchUrlTool({ saveDir: dir, fetchFn: plainFetch, now: FIXED_NOW }),
      { url: "https://x.com/readme.txt" },
    );
    const files = fs.readdirSync(dir);
    const content = fs.readFileSync(path.join(dir, files[0]), "utf8");
    expect(content).toContain("just text");
  });

  it("refuses PDFs with a friendly message and writes nothing", async () => {
    const pdfFetch: FetchFn = async () => response("%PDF-1.4", "application/pdf");
    const out = await runTool(
      fetchUrlTool({ saveDir: dir, fetchFn: pdfFetch, now: FIXED_NOW }),
      { url: "https://ti.com/lm317.pdf" },
    );
    expect(out).toMatch(/pdf/i);
    expect(out).toMatch(/fetch_pdf/);
    expect(fs.readdirSync(dir)).toHaveLength(0);
  });

  it("refuses other content types naming the type", async () => {
    const imgFetch: FetchFn = async () => response("...", "image/png");
    const out = await runTool(
      fetchUrlTool({ saveDir: dir, fetchFn: imgFetch, now: FIXED_NOW }),
      { url: "https://x.com/logo.png" },
    );
    expect(out).toContain("image/png");
    expect(fs.readdirSync(dir)).toHaveLength(0);
  });

  it("refuses non-http(s) schemes and invalid URLs", async () => {
    const tool = fetchUrlTool({ saveDir: dir, fetchFn: htmlFetch, now: FIXED_NOW });
    expect(await runTool(tool, { url: "file:///etc/passwd" })).toMatch(
      /only http/i,
    );
    expect(await runTool(tool, { url: "not a url" })).toMatch(/not a valid URL/i);
    expect(fs.readdirSync(dir)).toHaveLength(0);
  });

  it("refuses oversize responses — via content-length pre-check and via body size", async () => {
    const declared: FetchFn = async () =>
      response(PAGE, "text/html", 200, 9_999_999);
    const out1 = await runTool(
      fetchUrlTool({ saveDir: dir, fetchFn: declared, now: FIXED_NOW }),
      { url: "https://x.com/big" },
    );
    expect(out1).toMatch(/bytes/);

    const undeclared: FetchFn = async () => response("x".repeat(2000), "text/html");
    const out2 = await runTool(
      fetchUrlTool({
        saveDir: dir,
        maxResponseBytes: 1000,
        fetchFn: undeclared,
        now: FIXED_NOW,
      }),
      { url: "https://x.com/big2" },
    );
    expect(out2).toMatch(/bytes/);
    expect(fs.readdirSync(dir)).toHaveLength(0);
  });

  it("reports non-2xx and network failures as strings", async () => {
    const notFound: FetchFn = async () => response("nope", "text/html", 404);
    const failing: FetchFn = async () => {
      throw new Error("getaddrinfo ENOTFOUND");
    };
    const out1 = await runTool(
      fetchUrlTool({ saveDir: dir, fetchFn: notFound, now: FIXED_NOW }),
      { url: "https://x.com/missing" },
    );
    const out2 = await runTool(
      fetchUrlTool({ saveDir: dir, fetchFn: failing, now: FIXED_NOW }),
      { url: "https://x.com/down" },
    );
    expect(out1).toContain("404");
    expect(out2).toContain("ENOTFOUND");
  });

  it("resolves saveDir as a function of the run config (per-thread dirs)", async () => {
    const seen: Array<RunnableConfig | undefined> = [];
    const tool = fetchUrlTool({
      saveDir: (config) => {
        seen.push(config);
        const thread = (config?.configurable as { thread_id?: string } | undefined)
          ?.thread_id;
        return path.join(dir, thread ?? "default");
      },
      fetchFn: htmlFetch,
      now: FIXED_NOW,
    });
    await tool.invoke(
      { url: "https://ti.com/lm317" },
      { configurable: { thread_id: "buck-v1" } },
    );
    expect(seen).toHaveLength(1);
    expect(fs.readdirSync(path.join(dir, "buck-v1"))).toHaveLength(1);
  });

  it("returns a filesystem failure as a friendly string", async () => {
    const filePath = path.join(dir, "not-a-dir");
    fs.writeFileSync(filePath, "occupied");
    const out = await runTool(
      fetchUrlTool({ saveDir: filePath, fetchFn: htmlFetch, now: FIXED_NOW }),
      { url: "https://ti.com/lm317" },
    );
    expect(out).toMatch(/could not save/i);
  });

  it("refuses private/loopback/link-local addresses by default and writes nothing", async () => {
    const seen: string[] = [];
    const spyFetch: FetchFn = async (url) => {
      seen.push(url);
      return response(PAGE, "text/html");
    };
    const tool = fetchUrlTool({ saveDir: dir, fetchFn: spyFetch, now: FIXED_NOW });
    for (const url of [
      "http://localhost:6379/",
      "http://127.0.0.1/admin",
      "http://192.168.1.1/",
      "http://10.0.0.5/",
      "http://169.254.169.254/latest/meta-data/", // cloud metadata
      "http://[::1]/",
      "http://redis.internal/",
    ]) {
      const out = await runTool(tool, { url });
      expect(out).toMatch(/private\/loopback/i);
    }
    expect(seen).toHaveLength(0); // refused before any fetch happened
    expect(fs.readdirSync(dir)).toHaveLength(0);
  });

  it("fetches a private address when allowPrivate is set", async () => {
    const tool = fetchUrlTool({
      saveDir: dir,
      allowPrivate: true,
      fetchFn: htmlFetch,
      now: FIXED_NOW,
    });
    const out = await runTool(tool, { url: "http://localhost:8080/page" });
    expect(out).toContain("LM317 Product Page");
    expect(fs.readdirSync(dir)).toHaveLength(1);
  });

  it("refuses a public URL that redirects to a private address", async () => {
    const redirecting: FetchFn = async () => ({
      ...response(PAGE, "text/html"),
      url: "http://169.254.169.254/latest/meta-data/", // where we actually landed
    });
    const out = await runTool(
      fetchUrlTool({ saveDir: dir, fetchFn: redirecting, now: FIXED_NOW }),
      { url: "https://totally-legit.example/go" },
    );
    expect(out).toMatch(/redirected to the private\/loopback/i);
    expect(fs.readdirSync(dir)).toHaveLength(0);
  });

  it("records the post-redirect URL in the frontmatter", async () => {
    const redirecting: FetchFn = async () => ({
      ...response(PAGE, "text/html"),
      url: "https://ti.com/lm317-final",
    });
    await runTool(
      fetchUrlTool({ saveDir: dir, fetchFn: redirecting, now: FIXED_NOW }),
      { url: "https://ti.com/short" },
    );
    const [file] = fs.readdirSync(dir);
    const content = fs.readFileSync(path.join(dir, file), "utf8");
    expect(content).toContain("url: https://ti.com/lm317-final");
    expect(content).not.toContain("url: https://ti.com/short");
  });
});
