import fs from "node:fs";

/** Number of leading bytes sniffed for a NUL when deciding text vs binary. */
const SNIFF_BYTES = 8_000;

/** Basic stats about a single file, shared by read_lines and file_stats. */
export interface FileInfo {
  bytes: number;
  /** Line count, or `null` when the file is binary or too large to count. */
  lines: number | null;
  binary: boolean;
}

/** A file is treated as binary if a NUL byte appears in its leading chunk. */
export function looksBinary(buf: Buffer): boolean {
  const n = Math.min(buf.length, SNIFF_BYTES);
  for (let i = 0; i < n; i++) {
    if (buf[i] === 0) return true;
  }
  return false;
}

/** Count lines the same way read_lines pages them (trailing newline ignored). */
function countLines(buf: Buffer): number {
  if (buf.length === 0) return 0;
  let count = 0;
  for (let i = 0; i < buf.length; i++) {
    if (buf[i] === 0x0a) count++;
  }
  // A final line without a trailing newline still counts.
  if (buf[buf.length - 1] !== 0x0a) count++;
  return count;
}

/**
 * Inspect a file: byte size, binary flag, and line count. For files over
 * `maxFileBytes` only the leading chunk is read (for the binary sniff) and the
 * line count is reported as `null` — file_stats stays cheap on huge files.
 */
export function inspectFile(abs: string, maxFileBytes: number): FileInfo {
  const bytes = fs.statSync(abs).size;
  if (bytes > maxFileBytes) {
    const fd = fs.openSync(abs, "r");
    try {
      const head = Buffer.alloc(Math.min(SNIFF_BYTES, bytes));
      fs.readSync(fd, head, 0, head.length, 0);
      return { bytes, lines: null, binary: looksBinary(head) };
    } finally {
      fs.closeSync(fd);
    }
  }
  const buf = fs.readFileSync(abs);
  const binary = looksBinary(buf);
  return { bytes, lines: binary ? null : countLines(buf), binary };
}
