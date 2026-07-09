import fs from "node:fs";
import path from "node:path";

import { fetchPdfTool, UNPDF_MISSING_MESSAGE } from "../web-research/fetch-pdf";
import type { FetchFn, FetchResponseLike, LoadUnpdf } from "../web-research/options";
import { makeTmpDir, removeTmpDir, runTool } from "./tmp-tree";

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

  it("extracts a real PDF's text with unpdf and saves it as markdown", async () => {
    const bytes = makePdf("Hello LM317 datasheet");
    const pdfFetch: FetchFn = async () => pdfResponse(bytes);
    const tool = fetchPdfTool({ saveDir: dir, fetchFn: pdfFetch, now: FIXED_NOW });

    const out = await runTool(tool, { url: "https://ti.com/lm317.pdf" });
    expect(out).toMatch(/search_files|read_lines/);

    const files = fs.readdirSync(dir);
    expect(files).toHaveLength(1);
    const content = fs.readFileSync(path.join(dir, files[0]), "utf8");
    expect(content).toContain("url: https://ti.com/lm317.pdf");
    expect(content).toContain("fetched: 2026-07-08");
    expect(content).toContain("LM317");
    expect(content).toContain("datasheet");
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
});
