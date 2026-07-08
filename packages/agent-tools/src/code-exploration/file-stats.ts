import fs from "node:fs";
import path from "node:path";

import { tool } from "@langchain/core/tools";
import type { StructuredToolInterface } from "@langchain/core/tools";
import { z } from "zod";

import { createSandbox, SandboxError } from "./sandbox";
import { inspectFile, type FileInfo } from "./file-info";
import { runRg } from "./run-rg";
import {
  resolveOptions,
  type CodeExplorationOptions,
  type ResolvedCodeExplorationOptions,
} from "./options";

const DESCRIPTION =
  "Inspect the sandboxed project before reading it. With no `path` (or a " +
  "directory `path`) it lists that directory's files with per-file line " +
  "counts, capped with a truncation marker — pass a subdirectory `path` to " +
  "narrow. With a file `path` it reports line count, byte size, and whether " +
  "the file is binary. Use this first to learn what exists and how big things " +
  "are, so you can search_code precisely and read_lines only the pages you " +
  "need. Read-only; never looks outside the project root.";

const fileStatsInputSchema = z.object({
  path: z
    .string()
    .optional()
    .describe(
      "File or directory to inspect, relative to the project root " +
        "(defaults to the root itself). Absolute paths must resolve inside it.",
    ),
});

/** A "module not found" spawn error, matched by its Node error code. */
const enoentError = z.object({ code: z.literal("ENOENT") });

/** Recursive fallback listing used when ripgrep is unavailable. */
function walkFiles(dir: string): string[] {
  const out: string[] = [];
  const recur = (cur: string, prefix: string): void => {
    for (const ent of fs.readdirSync(cur, { withFileTypes: true })) {
      if (ent.name === "node_modules" || ent.name === ".git") continue;
      const rel = prefix ? `${prefix}/${ent.name}` : ent.name;
      if (ent.isDirectory()) recur(path.join(cur, ent.name), rel);
      else if (ent.isFile()) out.push(rel);
    }
  };
  recur(dir, "");
  return out;
}

/** Gather the relative file list for a directory, gitignore-aware via ripgrep. */
async function listFiles(absDir: string): Promise<string[]> {
  try {
    const { stdout, code } = await runRg(["--files", "."], absDir);
    // 0 = files listed, 1 = none; anything else, fall back to a plain walk.
    if (code >= 2) return walkFiles(absDir);
    return stdout
      .split("\n")
      .filter((l) => l.length > 0)
      // Strip the "./" ripgrep prepends when listing an explicit "." path.
      .map((l) => (l.startsWith("./") ? l.slice(2) : l));
  } catch (err) {
    if (enoentError.safeParse(err).success) return walkFiles(absDir);
    throw err;
  }
}

/** Render one file's stats line. */
function describeFile(rel: string, info: FileInfo): string {
  if (info.binary) return `${rel} — ${info.bytes} bytes, binary`;
  if (info.lines === null) {
    return `${rel} — ${info.bytes} bytes, text (too large to count lines)`;
  }
  return `${rel} — ${info.lines} lines, ${info.bytes} bytes, text`;
}

/** Format a directory listing capped by BOTH entry count and byte size. */
function formatListing(
  displayPath: string,
  absDir: string,
  rels: string[],
  opts: ResolvedCodeExplorationOptions,
): string {
  const sorted = [...rels].sort();
  const total = sorted.length;
  const header = `${displayPath} — ${total} file${total === 1 ? "" : "s"}:`;

  const capped = sorted.slice(0, opts.maxMatches);
  const shown: string[] = [];
  let bytes = Buffer.byteLength(header + "\n");
  for (const rel of capped) {
    let line: string;
    try {
      line = describeFile(rel, inspectFile(path.join(absDir, rel), opts.maxFileBytes));
    } catch {
      line = `${rel} — (unreadable)`;
    }
    const lineBytes = Buffer.byteLength(line + "\n");
    if (bytes + lineBytes > opts.maxOutputBytes) break;
    shown.push(line);
    bytes += lineBytes;
  }

  const remaining = total - shown.length;
  const body = [header, ...shown];
  if (remaining > 0) {
    body.push(
      `… truncated: ${remaining} more entries — pass a subdirectory path to narrow`,
    );
  }
  return body.join("\n");
}

/**
 * `file_stats` — size up a file or directory before reading. For a file:
 * lines, bytes, binary flag. For a directory (or the root when `path` is
 * omitted): a bounded, gitignore-aware listing with per-file line counts and a
 * truncation marker. Sandboxed and read-only.
 */
export function fileStatsTool(options: CodeExplorationOptions): StructuredToolInterface {
  const opts = resolveOptions(options);
  const sandbox = createSandbox(opts.root);

  return tool(
    async ({ path: input }) => {
      const display = input && input.length > 0 ? input : ".";
      let abs: string;
      try {
        abs = sandbox.resolve(input ?? ".");
      } catch (err) {
        if (err instanceof SandboxError) return err.message;
        throw err;
      }

      let stat: fs.Stats;
      try {
        stat = fs.statSync(abs);
      } catch {
        return `file_stats: no such file or directory: "${display}".`;
      }

      if (stat.isDirectory()) {
        return formatListing(display, abs, await listFiles(abs), opts);
      }
      return describeFile(display, inspectFile(abs, opts.maxFileBytes));
    },
    { name: "file_stats", description: DESCRIPTION, schema: fileStatsInputSchema },
  );
}
