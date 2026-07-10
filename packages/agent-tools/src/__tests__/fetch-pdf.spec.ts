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

  // The extraction test stubs the unpdf loader via the same injectable seam
  // the missing-peer test uses. `unpdf` is ESM-only, and jest 30's CJS vm
  // context cannot execute the genuine dynamic `import()` in load-unpdf.ts
  // without `--experimental-vm-modules` — worse, unpdf's own CJS build
  // dynamic-imports its ESM-only pdf.js bundle at extraction time, so no
  // loader-side fallback can dodge the flag either. Rather than bend the
  // whole test runtime around one dependency, jest never loads the real
  // module: the PDF bytes still flow through the full fetch → guard →
  // content-type check → save pipeline, but the real ESM `import("unpdf")`
  // path in load-unpdf.ts is intentionally not exercised under jest at all —
  // there is no automated smoke check for it. It was manually verified
  // against the built `dist` output (see load-unpdf.ts's own comment).
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
});
