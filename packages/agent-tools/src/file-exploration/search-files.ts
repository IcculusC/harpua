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
 * Ask ripgrep to LIST candidate files rather than search them. `--quiet` makes
 * it stop at the first hit and print nothing, so the EXIT CODE is the whole
 * answer (0 = at least one file, 1 = none) — no stdout to parse and no full
 * tree walk. Pass `respectIgnoreRules: false` to see files that exist but are
 * excluded by `.gitignore`/`.ignore`.
 */
function buildProbeArgs(glob: string | undefined, respectIgnoreRules: boolean): string[] {
  const args = ["--files", "--quiet"];
  if (!respectIgnoreRules) args.push("--no-ignore", "--hidden");
  if (glob !== undefined) args.push("--glob", glob);
  args.push(".");
  return args;
}

/** Why did ripgrep search nothing — or did it in fact search? */
type EmptyCause =
  /** Files were searched; the pattern really is absent. "No matches." is true. */
  | "searched"
  /** Nothing matched the glob (or the tree holds no searchable files). */
  | "no-such-file"
  /** Files exist, but ignore rules excluded every one of them. */
  | "ignored"
  /** The probe itself failed. We do not know, and must not guess. */
  | "unknown";

/**
 * Ripgrep's exit code 1 means "produced no matches" — which is several
 * different facts. Establish which.
 *
 * This cannot be one question: `--files` honors ignore rules EXACTLY as the
 * search does, so an empty listing means either "nothing matched the glob" or
 * "everything matching it is gitignored". Those demand opposite advice, and
 * telling an agent to fix a glob that was never broken sends it into precisely
 * the loop this whole fix exists to break.
 */
async function diagnoseEmptySearch(glob: string | undefined, root: string): Promise<EmptyCause> {
  const respecting = await runRg(buildProbeArgs(glob, true), root);
  // The probe broke. Don't invent a cause — fall back to the plain negative.
  if (respecting.code >= 2) return "unknown";
  // Files WERE searched, so the pattern is genuinely absent from them.
  if (respecting.code === 0) return "searched";

  // Nothing was searched. Ignore rules, or nothing there at all?
  const ignoring = await runRg(buildProbeArgs(glob, false), root);
  if (ignoring.code >= 2) return "unknown";
  return ignoring.code === 0 ? "ignored" : "no-such-file";
}

/**
 * Returned instead of "No matches." when nothing was searched. The message must
 * actively stop the agent concluding the pattern is absent — it has no evidence
 * either way, because no file was opened — and must name the REAL cause, since
 * the remedy for a bad glob and the remedy for an ignored file are opposites.
 */
function nothingSearchedMessage(
  pattern: string,
  glob: string | undefined,
  cause: "no-such-file" | "ignored",
): string {
  let why: string;
  let hint: string;

  if (cause === "ignored") {
    why =
      glob === undefined
        ? "every file in the project is excluded by ignore rules (.gitignore/.ignore)"
        : `every file matching "${glob}" is excluded by ignore rules (.gitignore/.ignore)`;
    // Do NOT suggest dropping the glob: those files are ignored, not merely
    // out of scope, so a broader search would skip them too and hand back a
    // confident partial answer.
    hint = "They are ignored, not missing — a broader search would skip them too.";
  } else {
    why =
      glob === undefined
        ? "the project contains no searchable files"
        : `the glob "${glob}" matched no files`;
    hint =
      glob === undefined
        ? ""
        : 'Globs are relative to the project root, and a bare directory name matches nothing — use "src/**", not "src".';
  }

  return (
    `search_files: nothing was searched — ${why}. ` +
    `This is NOT evidence that "${pattern}" is absent: no file was opened.` +
    (hint === "" ? "" : ` ${hint}`)
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
          // "Produced no matches" is not one fact. It is "searched, found
          // nothing" — or "searched nothing at all", which is not evidence of
          // anything and must never be reported as though it were. A glob is
          // the common cause but NOT the only one (an empty tree, or a root
          // where ignore rules exclude everything, does it with no glob), so
          // ask unconditionally. The cost lands only on a path that was
          // already a dead end, and `--quiet` makes the probe early-exit.
          const cause = await diagnoseEmptySearch(glob, sandbox.root);
          if (cause === "searched" || cause === "unknown") return "No matches.";
          return nothingSearchedMessage(pattern, glob, cause);
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
