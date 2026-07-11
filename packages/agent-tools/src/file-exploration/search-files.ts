import { tool } from "@langchain/core/tools";
import type { StructuredToolInterface } from "@langchain/core/tools";
import { z } from "zod";

import { createSandbox } from "./sandbox";
import { runRg } from "./run-rg";
import {
  resolveOptions,
  type FileExplorationOptions,
  type ResolvedFileExplorationOptions,
} from "./options";

/** Shown when the `rg` binary is not installed on the host. */
export const RG_MISSING_MESSAGE =
  "ripgrep (rg) is required for search_files — install it: " +
  "brew install ripgrep / apt install ripgrep";

const DESCRIPTION =
  "Search file contents across the sandboxed project with ripgrep. `pattern` " +
  "is a regular expression (ripgrep syntax; escape literals). Optionally pass " +
  "a `glob` (e.g. `src/**/*.ts`) to narrow the files searched. Results are " +
  "`path:line:text`, respect .gitignore, and are capped — a truncation marker " +
  "tells you when to narrow your pattern or add a glob. Search before you " +
  "read: use this to locate the handful of lines you need, then open just " +
  "those with read_lines. Read-only; never searches outside the project root.";

const searchFilesInputSchema = z.object({
  pattern: z
    .string()
    .min(1)
    .describe("Ripgrep regular expression to search for. Escape regex literals."),
  glob: z
    .string()
    .optional()
    .describe("Optional ripgrep glob to narrow the files searched, e.g. `src/**/*.ts`."),
});

/** A "module not found" spawn error, matched by its Node error code. */
const enoentError = z.object({ code: z.literal("ENOENT") });

/** Build the ripgrep argument array. The `--` guard means a `-`-leading pattern is safe. */
function buildSearchArgs(pattern: string, glob: string | undefined, maxMatches: number): string[] {
  const args = [
    "--line-number",
    "--no-heading",
    "--color=never",
    "--max-count",
    String(maxMatches),
  ];
  if (glob !== undefined) args.push("--glob", glob);
  // Explicit search path: without one, ripgrep reads a piped stdin (the child's
  // stdin is a pipe, not a TTY) and blocks forever. "." searches the cwd tree.
  args.push("--", pattern, ".");
  return args;
}

/**
 * Ask ripgrep which files a glob actually matches. `--files` LISTS candidate
 * files without searching them, so this answers "was anything searched?" — the
 * question ripgrep's exit code cannot answer on its own.
 */
function buildFileListArgs(glob: string): string[] {
  return ["--files", "--glob", glob, "."];
}

/**
 * Returned instead of "No matches." when the glob excluded every file. The
 * message must actively stop the agent concluding the pattern is absent: it
 * has no evidence either way, because nothing was read.
 */
function nothingSearchedMessage(pattern: string, glob: string): string {
  return (
    `search_files: the glob "${glob}" matched no files, so nothing was searched. ` +
    `This is NOT evidence that "${pattern}" is absent — no file was opened. ` +
    "Check the glob (it is relative to the project root), or search without one."
  );
}

/** Cap ripgrep output by BOTH match count and byte size, appending a marker. */
function formatMatches(stdout: string, opts: ResolvedFileExplorationOptions): string {
  const lines = stdout
    .split("\n")
    .filter((l) => l.length > 0)
    // Strip the "./" ripgrep prepends when searching an explicit "." path.
    .map((l) => (l.startsWith("./") ? l.slice(2) : l));
  const total = lines.length;
  const withinCount = lines.slice(0, opts.maxMatches);

  const shown: string[] = [];
  let bytes = 0;
  for (const line of withinCount) {
    const lineBytes = Buffer.byteLength(line + "\n");
    if (bytes + lineBytes > opts.maxOutputBytes) break;
    shown.push(line);
    bytes += lineBytes;
  }

  const remaining = total - shown.length;
  if (remaining > 0) {
    shown.push(
      `… truncated: ${remaining} more matches — narrow your pattern or add a glob`,
    );
  }
  return shown.join("\n");
}

/**
 * `search_files` — regex search over the sandboxed project via ripgrep. Bounded
 * (match + byte caps with a truncation marker), read-only, and confined to the
 * configured root. Falls back to a clear install hint when `rg` is absent.
 *
 * Distinguishes three outcomes ripgrep's exit code conflates into two: a real
 * ripgrep error, "searched and found nothing", and "the glob matched no files,
 * so nothing was searched" — the last being the one that misleads an agent into
 * believing a pattern is absent from files it never opened.
 */
export function searchFilesTool(options: FileExplorationOptions): StructuredToolInterface {
  const opts = resolveOptions(options);
  const sandbox = createSandbox(opts.root);

  return tool(
    async ({ pattern, glob }) => {
      try {
        const { stdout, stderr, code } = await runRg(
          buildSearchArgs(pattern, glob, opts.maxMatches),
          sandbox.root,
        );
        if (code === 1) {
          // Exit 1 means "produced no matches" — which is TWO different facts:
          // the pattern is absent from the files searched, or the glob excluded
          // every file and nothing was searched at all. ripgrep cannot tell us
          // which. Only a glob can cause the second, so only then do we ask.
          // The cost lands solely on a path that was already a dead end.
          if (glob !== undefined) {
            const listed = await runRg(buildFileListArgs(glob), sandbox.root);
            const matchedAFile = listed.stdout.split("\n").some((l) => l.trim().length > 0);
            if (!matchedAFile) return nothingSearchedMessage(pattern, glob);
          }
          return "No matches.";
        }
        if (code >= 2) {
          return `search_files failed: ${stderr.trim() || `ripgrep exited ${code}`}`;
        }
        return formatMatches(stdout, opts);
      } catch (err) {
        if (enoentError.safeParse(err).success) return RG_MISSING_MESSAGE;
        throw err;
      }
    },
    { name: "search_files", description: DESCRIPTION, schema: searchFilesInputSchema },
  );
}
