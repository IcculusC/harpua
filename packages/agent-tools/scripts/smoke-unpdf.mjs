#!/usr/bin/env node
/**
 * Standalone smoke test for the REAL `unpdf` ESM import path.
 *
 * `fetch-pdf.spec.ts` (run under jest) mocks the `loadUnpdf` seam because
 * unpdf is ESM-only and jest's CJS/ESM sandbox can't execute the genuine
 * dynamic `import("unpdf")` (and unpdf's own CJS build dynamic-imports its
 * ESM-only pdf.js bundle at extraction time, so no loader-side workaround
 * fixes it either). That leaves the real import path — the one `fetch_pdf`
 * actually uses in production — completely unexercised by the test suite.
 *
 * This script closes that gap: it's a plain `.mjs` run directly by node
 * (outside jest), which handles unpdf's ESM natively. It builds a tiny,
 * valid PDF containing known text, loads the real `unpdf` package, extracts
 * the text, and asserts the known text comes back out.
 *
 * Run: `pnpm --filter @harpua/agent-tools smoke:unpdf`
 */

const KNOWN_TEXT = "Hello smoke";

/**
 * Author a minimal, valid, uncompressed single-page PDF whose page draws
 * `text`, with a correct xref table (byte offsets computed programmatically).
 * Mirrors the `makePdf` helper in `src/__tests__/fetch-pdf.spec.ts`.
 */
function makePdf(text) {
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
  const offsets = [];
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

// Same "hide the import from tsc/bundlers, keep it a real dynamic import()"
// trick as `src/web-research/load-unpdf.ts` — reimplemented inline here
// since this script runs standalone, outside the compiled package.
const dynamicImport = new Function("specifier", "return import(specifier);");

async function main() {
  const bytes = makePdf(KNOWN_TEXT);

  const unpdf = await dynamicImport("unpdf");
  const { text, totalPages } = await unpdf.extractText(bytes, {
    mergePages: true,
  });

  if (typeof text !== "string" || !text.includes(KNOWN_TEXT)) {
    console.error(
      `FAIL: extracted text did not contain "${KNOWN_TEXT}". Got: ${JSON.stringify(text)}`,
    );
    process.exit(1);
  }
  if (totalPages !== 1) {
    console.error(`FAIL: expected totalPages === 1, got ${totalPages}`);
    process.exit(1);
  }

  console.log(
    `OK: real unpdf.extractText() found "${KNOWN_TEXT}" across ${totalPages} page(s), ` +
      `${text.length} chars extracted.`,
  );
  process.exit(0);
}

main().catch((err) => {
  console.error("FAIL: smoke-unpdf threw:", err);
  process.exit(1);
});
