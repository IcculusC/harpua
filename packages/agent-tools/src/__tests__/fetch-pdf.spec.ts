import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";

import { fetchPdfTool, UNPDF_MISSING_MESSAGE } from "../web-research/fetch-pdf.js";
import { loadUnpdf } from "../web-research/load-unpdf.js";
import type { FetchFn, FetchResponseLike, LoadUnpdf } from "../web-research/options.js";
import { makeTmpDir, removeTmpDir, runTool } from "./tmp-tree.js";

const FIXED_NOW = () => new Date("2026-07-08T12:00:00Z");

/**
 * Author a minimal, valid, uncompressed single-page PDF whose page draws
 * `text`, with a correct xref table (byte offsets computed programmatically).
 * Real enough that `unpdf`'s pdf.js extracts the words back out.
 */
function makePdf(text: string): Uint8Array {
  const stream = `BT /F1 24 Tf 72 700 Td (${text}) Tj ET`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] " +
      "/Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];

  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(pdf.length); // ASCII-only, so string length === byte offset
    pdf += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xrefOffset = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  offsets.forEach((off) => {
    pdf += `${String(off).padStart(10, "0")} 00000 n \n`;
  });
  pdf +=
    `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\n` +
    `startxref\n${xrefOffset}\n%%EOF`;
  return new TextEncoder().encode(pdf);
}

function pdfResponse(
  bytes: Uint8Array,
  contentType = "application/pdf",
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
    text: async () => new TextDecoder().decode(bytes),
    arrayBuffer: async () =>
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
  };
}

describe("fetch_pdf", () => {
  let dir: string;
  beforeEach(() => (dir = makeTmpDir()));
  afterEach(() => removeTmpDir(dir));

  // Most tests stub the unpdf loader through the injectable `loadUnpdf` seam
  // (the same one the missing-peer test uses), so the PDF bytes flow through the
  // full fetch -> guard -> content-type check -> save pipeline without parsing.
  // The real `import("unpdf")` path is covered by the "real unpdf" describe at
  // the bottom of this file.
  it("extracts a PDF's text and saves it as markdown", async () => {
    const bytes = makePdf("Hello LM317 datasheet");
    const extracted = "Dropout voltage 1.5 V typical.";
    const pdfFetch: FetchFn = async () => pdfResponse(bytes);
    const tool = fetchPdfTool({
      saveDir: dir,
      fetchFn: pdfFetch,
      now: FIXED_NOW,
      loadUnpdf: async () => ({
        extractText: async () => ({
          totalPages: 1,
          text: [extracted],
        }),
      }),
    });

    const out = await runTool(tool, { url: "https://ti.com/lm317.pdf" });
    expect(out).toMatch(/search_files|read_lines/);
    // The summary reports the saved markdown's size (page headings included)
    // in chars/pages — never a line count.
    const savedMarkdown = `## Page 1\n\n${extracted}`;
    expect(out).toContain(
      `(${savedMarkdown.length.toLocaleString()} chars, 1 page)`,
    );
    expect(out).not.toMatch(/\blines\)/);

    const files = fs.readdirSync(dir);
    expect(files).toHaveLength(1);
    // Bare filename in the confirmation — the address the jailed
    // file-exploration tools accept (see fetch-url.spec for the full why).
    expect(out).toContain(`as ${files[0]}.`);
    expect(out).not.toContain(dir);
    const content = fs.readFileSync(path.join(dir, files[0]), "utf8");
    expect(content).toContain("url: https://ti.com/lm317.pdf");
    expect(content).toContain("fetched: 2026-07-08");
    // Pages become h2 sections so the knowledge chunker sees real structure
    // (page-sized chunks, "Page N" heading trails) instead of one giant
    // blank-line-free paragraph.
    expect(content).toContain("## Page 1");
    expect(content).toContain("Dropout voltage");
    expect(content).toContain("1.5 V typical");
  });

  it("pluralizes the page count and writes one heading per page", async () => {
    const bytes = makePdf("multi-page doc");
    const pdfFetch: FetchFn = async () => pdfResponse(bytes);
    const tool = fetchPdfTool({
      saveDir: dir,
      fetchFn: pdfFetch,
      now: FIXED_NOW,
      loadUnpdf: async () => ({
        extractText: async () => ({
          totalPages: 3,
          text: ["Page one content.", "Page two content.", "Page three content."],
        }),
      }),
    });

    const out = await runTool(tool, { url: "https://ti.com/lm317.pdf" });
    expect(out).toMatch(/\(\d+ chars, 3 pages\)/);
    const content = fs.readFileSync(
      path.join(dir, fs.readdirSync(dir)[0]),
      "utf8",
    );
    expect(content).toContain("## Page 1\n\nPage one content.");
    expect(content).toContain("## Page 2\n\nPage two content.");
    expect(content).toContain("## Page 3\n\nPage three content.");
  });

  it("skips blank pages but keeps true page numbers in the headings", async () => {
    const bytes = makePdf("sparse doc");
    const pdfFetch: FetchFn = async () => pdfResponse(bytes);
    const tool = fetchPdfTool({
      saveDir: dir,
      fetchFn: pdfFetch,
      now: FIXED_NOW,
      loadUnpdf: async () => ({
        extractText: async () => ({
          totalPages: 3,
          text: ["Intro text.", "   ", "Electrical specs."],
        }),
      }),
    });

    await runTool(tool, { url: "https://ti.com/sparse.pdf" });
    const content = fs.readFileSync(
      path.join(dir, fs.readdirSync(dir)[0]),
      "utf8",
    );
    expect(content).toContain("## Page 1");
    expect(content).not.toContain("## Page 2");
    expect(content).toContain("## Page 3");
  });

  it("returns a friendly message (and saves nothing) when no text extracts", async () => {
    const bytes = makePdf("scanned images only");
    const pdfFetch: FetchFn = async () => pdfResponse(bytes);
    const tool = fetchPdfTool({
      saveDir: dir,
      fetchFn: pdfFetch,
      now: FIXED_NOW,
      loadUnpdf: async () => ({
        extractText: async () => ({ totalPages: 2, text: ["", "   "] }),
      }),
    });

    const out = await runTool(tool, { url: "https://ti.com/scan.pdf" });
    expect(out).toContain("no extractable text");
    expect(out).toContain("2 pages");
    expect(fs.readdirSync(dir)).toHaveLength(0);
  });

  it("returns an install hint when the optional unpdf peer is missing", async () => {
    const bytes = makePdf("anything");
    const pdfFetch: FetchFn = async () => pdfResponse(bytes);
    const missingLoader: LoadUnpdf = () =>
      Promise.reject(new Error("Cannot find module 'unpdf'"));
    const tool = fetchPdfTool({
      saveDir: dir,
      fetchFn: pdfFetch,
      now: FIXED_NOW,
      loadUnpdf: missingLoader,
    });

    const out = await runTool(tool, { url: "https://ti.com/lm317.pdf" });
    expect(out).toBe(UNPDF_MISSING_MESSAGE);
    expect(out).toMatch(/pnpm add unpdf/);
    expect(fs.readdirSync(dir)).toHaveLength(0);
  });

  it("refuses private/loopback addresses via the shared guard (never fetches)", async () => {
    const seen: string[] = [];
    const spyFetch: FetchFn = async (url) => {
      seen.push(url);
      return pdfResponse(makePdf("x"));
    };
    const tool = fetchPdfTool({ saveDir: dir, fetchFn: spyFetch, now: FIXED_NOW });
    for (const url of [
      "http://localhost/x.pdf",
      "http://169.254.169.254/x.pdf", // cloud metadata
      "http://[::1]/x.pdf",
    ]) {
      const out = await runTool(tool, { url });
      expect(out).toMatch(/private\/loopback/i);
    }
    expect(seen).toHaveLength(0);
    expect(fs.readdirSync(dir)).toHaveLength(0);
  });

  it("refuses a non-PDF content type, naming what came back", async () => {
    const htmlFetch: FetchFn = async () =>
      pdfResponse(new TextEncoder().encode("<html></html>"), "text/html");
    const tool = fetchPdfTool({ saveDir: dir, fetchFn: htmlFetch, now: FIXED_NOW });
    const out = await runTool(tool, { url: "https://ti.com/not-a.pdf" });
    expect(out).toContain("text/html");
    expect(out).toMatch(/not a PDF/i);
    expect(fs.readdirSync(dir)).toHaveLength(0);
  });

  it("accepts an octet-stream response whose body is a real PDF (%PDF- magic bytes)", async () => {
    const bytes = makePdf("GitHub raw datasheet");
    const extracted = "Sniffed via %PDF- magic bytes.";
    const octetFetch: FetchFn = async () => pdfResponse(bytes, "application/octet-stream");
    const tool = fetchPdfTool({
      saveDir: dir,
      fetchFn: octetFetch,
      now: FIXED_NOW,
      loadUnpdf: async () => ({
        extractText: async () => ({ totalPages: 1, text: [extracted] }),
      }),
    });
    const out = await runTool(tool, {
      url: "https://raw.githubusercontent.com/x/y/z.pdf",
    });
    expect(out).toMatch(/search_files|read_lines/);
    const files = fs.readdirSync(dir);
    expect(files).toHaveLength(1);
    expect(fs.readFileSync(path.join(dir, files[0]), "utf8")).toContain("Sniffed via");
  });

  it("still refuses an octet-stream body that isn't a PDF, naming the missing signature", async () => {
    const octetHtml: FetchFn = async () =>
      pdfResponse(
        new TextEncoder().encode("<html><body>nope</body></html>"),
        "application/octet-stream",
      );
    const tool = fetchPdfTool({ saveDir: dir, fetchFn: octetHtml, now: FIXED_NOW });
    const out = await runTool(tool, { url: "https://example.com/page" });
    expect(out).toMatch(/not a PDF/i);
    expect(out).toContain("%PDF-");
    expect(fs.readdirSync(dir)).toHaveLength(0);
  });
});

describe("fetch_pdf with the real unpdf (default loader)", () => {
  let dir: string;
  beforeEach(() => (dir = makeTmpDir()));
  afterEach(() => removeTmpDir(dir));

  it("loadUnpdf() imports the real package and extracts text from a real PDF", async () => {
    const unpdf = await loadUnpdf();
    const { text, totalPages } = await unpdf.extractText(makePdf("Hello real unpdf"), {
      mergePages: true,
    });
    expect(totalPages).toBe(1);
    expect(text).toContain("Hello real unpdf");
  });

  it("fetchPdfTool without an injected loader extracts and saves the real text", async () => {
    const tool = fetchPdfTool({
      saveDir: dir,
      fetchFn: async () => pdfResponse(makePdf("Real LM317 datasheet")),
      now: FIXED_NOW,
    });
    const out = await runTool(tool, { url: "https://ti.com/lm317.pdf" });
    expect(out).toMatch(/search_files|read_lines/);
    const saved = fs
      .readdirSync(dir, { recursive: true, encoding: "utf8" })
      .filter((f) => f.endsWith(".md"));
    expect(saved).toHaveLength(1);
    expect(fs.readFileSync(path.join(dir, saved[0]!), "utf8")).toContain("Real LM317 datasheet");
  });
});
