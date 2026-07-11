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
  "tells you when to narrow your pattern or add a glob. Hidden files (dotfiles " +
  "and dot-directories like `.github/`) are NOT searched; read those directly " +
  "with read_lines. Search before you read: use this to locate the handful of " +
  "lines you need, then open just those with read_lines. Read-only; never " +
  "searches outside the project root.";

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

/** Which exclusion mechanisms a probe is allowed to see past. */
interface ProbeReach {
  /** Look inside dotfiles/dot-directories, which the search itself never does. */
  hidden: boolean;
  /** Look past `.gitignore`/`.ignore`. */
  ignored: boolean;
}

/**
 * Ask ripgrep to LIST candidate files rather than search them. `--quiet` makes
 * it stop at the first hit and print nothing, so the EXIT CODE is the whole
 * answer (0 = at least one file, 1 = none, >=2 = the probe broke) — no stdout
 * to parse and no full tree walk.
 *
 * A probe with no reach mirrors `buildSearchArgs` exactly, which is what makes
 * the comparison meaningful: any file the widened probes see and this one does
 * not was excluded by a mechanism we can then NAME.
 */
function buildProbeArgs(glob: string | undefined, reach: ProbeReach): string[] {
  const args = ["--files", "--quiet"];
  if (reach.hidden) args.push("--hidden");
  if (reach.ignored) args.push("--no-ignore");
  if (glob !== undefined) args.push("--glob", glob);
  // Widened probes walk `.git/`, which the search never does — so a glob like
  // "**/config" would match `.git/config` and we'd report git plumbing as the
  // user's ignored source file. Ripgrep globs are LAST-MATCH-WINS, so this
  // guard MUST be pushed after the caller's glob or it silently loses to it.
  if (reach.hidden || reach.ignored) args.push("--glob", "!.git/**");
  args.push(".");
  return args;
}

/** Why did ripgrep search nothing — or did it in fact search? */
type EmptyCause =
  /** Files were searched. (Note: ripgrep silently skips BINARY files it did open.) */
  | "searched"
  /** Nothing matched at all — no such file, under any reach. */
  | "no-such-file"
  /** The files exist, but they are hidden — and this tool never searches those. */
  | "hidden"
  /** The files exist and are visible, but ignore rules excluded every one. */
  | "ignored"
  /** A probe itself failed. We do not know, and must not guess. */
  | "unknown";

/**
 * Ripgrep's exit code 1 means "produced no matches" — which is several
 * different facts, and they demand OPPOSITE remedies. Establish which.
 *
 * This cannot be one question. `rg --files` honors ignore rules and skips
 * hidden files exactly as the search does, so an empty listing collapses three
 * causes into one. Widen the reach one mechanism at a time, and the first probe
 * that finds the file names the mechanism that excluded it:
 *
 *   1. no reach       — mirrors the search. Found something? It really searched.
 *   2. + hidden       — found only now? The files are hidden (dotfiles).
 *   3. + ignore rules — found only now? They are gitignored.
 *   none of the above — nothing matches, under any reach.
 *
 * Guessing here is how the original bug reproduces itself: telling an agent to
 * fix a glob that was never broken, or to give up on a file it could have read.
 */
async function diagnoseEmptySearch(glob: string | undefined, root: string): Promise<EmptyCause> {
  const asSearched = await runRg(buildProbeArgs(glob, { hidden: false, ignored: false }), root);
  if (asSearched.code >= 2) return "unknown";
  if (asSearched.code === 0) return "searched";

  const withHidden = await runRg(buildProbeArgs(glob, { hidden: true, ignored: false }), root);
  if (withHidden.code >= 2) return "unknown";
  if (withHidden.code === 0) return "hidden";

  const withIgnored = await runRg(buildProbeArgs(glob, { hidden: true, ignored: true }), root);
  if (withIgnored.code >= 2) return "unknown";
  return withIgnored.code === 0 ? "ignored" : "no-such-file";
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
  cause: "no-such-file" | "hidden" | "ignored",
): string {
  const scope = glob === undefined ? "the project" : `matching "${glob}"`;
  let why: string;
  let hint: string;

  if (cause === "hidden") {
    // The files are RIGHT THERE and readable — search_files just never looks at
    // dotfiles. Telling the agent to give up here would be the worst of all
    // outcomes, so point it at a tool that can actually read them.
    why =
      glob === undefined
        ? "every file in the project is hidden (a dotfile or inside a dot-directory)"
        : `every file ${scope} is hidden (a dotfile or inside a dot-directory)`;
    hint =
      "search_files does not search hidden files — nothing is wrong with your " +
      "glob. Read them directly with read_lines, which has no such restriction.";
  } else if (cause === "ignored") {
    why =
      glob === undefined
        ? "every file in the project is excluded by ignore rules (.gitignore/.ignore)"
        : `every file ${scope} is excluded by ignore rules (.gitignore/.ignore)`;
    // Do NOT suggest dropping the glob: these files are ignored, not merely out
    // of scope, so a broader search skips them too and hands back a confident
    // PARTIAL answer — the failure that looks most like success.
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
 * Ripgrep's exit code 1 conflates "searched, found nothing" with "searched
 * nothing at all", and the second is not evidence of anything. On an empty
 * search this diagnoses which — and, when nothing was searched, names the
 * mechanism responsible (no such file / hidden / ignored), because those need
 * opposite remedies and a wrong guess sends an agent hunting for a glob that
 * cannot exist, or abandoning a file it could simply have read.
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
