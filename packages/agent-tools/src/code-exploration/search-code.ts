import { tool } from "@langchain/core/tools";
import type { StructuredToolInterface } from "@langchain/core/tools";
import { z } from "zod";

import { createSandbox } from "./sandbox";
import { runRg } from "./run-rg";
import {
  resolveOptions,
  type CodeExplorationOptions,
  type ResolvedCodeExplorationOptions,
} from "./options";

/** Shown when the `rg` binary is not installed on the host. */
export const RG_MISSING_MESSAGE =
  "ripgrep (rg) is required for search_code — install it: " +
  "brew install ripgrep / apt install ripgrep";

const DESCRIPTION =
  "Search file contents across the sandboxed project with ripgrep. `pattern` " +
  "is a regular expression (ripgrep syntax; escape literals). Optionally pass " +
  "a `glob` (e.g. `src/**/*.ts`) to narrow the files searched. Results are " +
  "`path:line:text`, respect .gitignore, and are capped — a truncation marker " +
  "tells you when to narrow your pattern or add a glob. Search before you " +
  "read: use this to locate the handful of lines you need, then open just " +
  "those with read_lines. Read-only; never searches outside the project root.";

const searchCodeInputSchema = z.object({
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

/** Cap ripgrep output by BOTH match count and byte size, appending a marker. */
function formatMatches(stdout: string, opts: ResolvedCodeExplorationOptions): string {
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
 * `search_code` — regex search over the sandboxed project via ripgrep. Bounded
 * (match + byte caps with a truncation marker), read-only, and confined to the
 * configured root. Falls back to a clear install hint when `rg` is absent and
 * distinguishes "no matches" from a real ripgrep error.
 */
export function searchCodeTool(options: CodeExplorationOptions): StructuredToolInterface {
  const opts = resolveOptions(options);
  const sandbox = createSandbox(opts.root);

  return tool(
    async ({ pattern, glob }) => {
      try {
        const { stdout, stderr, code } = await runRg(
          buildSearchArgs(pattern, glob, opts.maxMatches),
          sandbox.root,
        );
        if (code === 1) return "No matches.";
        if (code >= 2) {
          return `search_code failed: ${stderr.trim() || `ripgrep exited ${code}`}`;
        }
        return formatMatches(stdout, opts);
      } catch (err) {
        if (enoentError.safeParse(err).success) return RG_MISSING_MESSAGE;
        throw err;
      }
    },
    { name: "search_code", description: DESCRIPTION, schema: searchCodeInputSchema },
  );
}
