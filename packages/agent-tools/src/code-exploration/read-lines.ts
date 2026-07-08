import fs from "node:fs";

import { tool } from "@langchain/core/tools";
import type { StructuredToolInterface } from "@langchain/core/tools";
import { z } from "zod";

import { createSandbox, SandboxError } from "./sandbox";
import { looksBinary } from "./file-info";
import { resolveOptions, type CodeExplorationOptions } from "./options";

const DESCRIPTION =
  "Read one bounded page of a text file inside the sandboxed project, with " +
  "line numbers. `path` is relative to the project root (absolute paths must " +
  "resolve inside it); `start` is a 1-based line number (default 1). Returns " +
  "up to one page of lines with a header (`file — lines A–B of TOTAL`) and, " +
  "when more remain, the exact `start=` to request the next page. Check size " +
  "first with file_stats and locate lines with search_code, then page through " +
  "with this — it never returns a whole file at once. Refuses binary and " +
  "oversize files. Read-only.";

const readLinesInputSchema = z.object({
  path: z
    .string()
    .min(1)
    .describe("File to read, relative to the project root (absolute paths must resolve inside it)."),
  start: z
    .number()
    .int()
    .positive()
    .optional()
    .describe("1-based line number to start the page at (default 1)."),
});

/**
 * `read_lines` — return one `pageLines`-sized, line-numbered page of a text
 * file. Sandboxed, read-only, and context-safe: refuses binary files (NUL
 * sniff) and files over `maxFileBytes`, and always tells you the `start=` for
 * the next page when more lines remain.
 */
export function readLinesTool(options: CodeExplorationOptions): StructuredToolInterface {
  const opts = resolveOptions(options);
  const sandbox = createSandbox(opts.root);

  return tool(
    ({ path: input, start }) => {
      let abs: string;
      try {
        abs = sandbox.resolve(input);
      } catch (err) {
        if (err instanceof SandboxError) return err.message;
        throw err;
      }

      let stat: fs.Stats;
      try {
        stat = fs.statSync(abs);
      } catch {
        return `read_lines: no such file: "${input}".`;
      }
      if (stat.isDirectory()) {
        return `read_lines: "${input}" is a directory — use file_stats to list it.`;
      }
      if (stat.size > opts.maxFileBytes) {
        return (
          `read_lines: "${input}" is ${stat.size} bytes, over the ` +
          `${opts.maxFileBytes}-byte limit — use search_code to find the lines ` +
          `you need, or file_stats for its size.`
        );
      }

      const buf = fs.readFileSync(abs);
      if (looksBinary(buf)) {
        return `read_lines: "${input}" looks binary (contains NUL bytes) — use file_stats instead.`;
      }

      const allLines = buf.toString("utf8").split("\n");
      if (allLines.length > 0 && allLines[allLines.length - 1] === "") allLines.pop();
      const total = allLines.length;

      if (total === 0) return `${input} — empty file (0 lines).`;

      const startLine = start ?? 1;
      if (startLine > total) {
        return `read_lines: start=${startLine} is past the end of "${input}" (${total} lines).`;
      }
      const endLine = Math.min(startLine + opts.pageLines - 1, total);
      const page = allLines.slice(startLine - 1, endLine);

      const width = String(endLine).length;
      const numbered = page.map(
        (line, i) => `${String(startLine + i).padStart(width)}  ${line}`,
      );

      let out = `${input} — lines ${startLine}–${endLine} of ${total}\n${numbered.join("\n")}`;
      if (endLine < total) {
        out += `\n… ${total - endLine} more lines — call again with start=${endLine + 1}`;
      }
      return out;
    },
    { name: "read_lines", description: DESCRIPTION, schema: readLinesInputSchema },
  );
}
