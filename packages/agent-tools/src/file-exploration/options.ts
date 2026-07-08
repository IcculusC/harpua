import { z } from "zod";

/** Sane default page size for {@link readLinesTool} (lines per page). */
export const DEFAULT_PAGE_LINES = 200;
/** Sane default match cap for {@link searchFilesTool}. */
export const DEFAULT_MAX_MATCHES = 50;
/** Sane default output byte cap for tool results that stream lines. */
export const DEFAULT_MAX_OUTPUT_BYTES = 16_384;
/**
 * Sane default file-size ceiling for {@link readLinesTool}. Files larger than
 * this are refused (with a pointer to file_stats/search_files) so a single read
 * can never flood the context.
 */
export const DEFAULT_MAX_FILE_BYTES = 2_000_000;

/**
 * Shared configuration for the file-exploration tool family. `root` is the only
 * required field; every cap has a bounded, context-safe default. Unknown keys
 * are rejected so typos surface immediately.
 */
export const fileExplorationOptionsSchema = z
  .object({
    /** Directory the tools are confined to. Validated (exists + is a dir) when a tool is built. */
    root: z.string().min(1),
    /** Lines returned per read_lines page. */
    pageLines: z.number().int().positive().default(DEFAULT_PAGE_LINES),
    /** Maximum matches search_files returns before a truncation marker. */
    maxMatches: z.number().int().positive().default(DEFAULT_MAX_MATCHES),
    /** Byte ceiling on streamed line output (search matches, directory listings). */
    maxOutputBytes: z.number().int().positive().default(DEFAULT_MAX_OUTPUT_BYTES),
    /** File-size ceiling above which read_lines refuses to open a file. */
    maxFileBytes: z.number().int().positive().default(DEFAULT_MAX_FILE_BYTES),
  })
  .strict();

/** Caller-facing options: `root` required, every cap optional (defaults apply). */
export type FileExplorationOptions = z.input<typeof fileExplorationOptionsSchema>;
/** Fully-resolved options with all defaults applied. */
export type ResolvedFileExplorationOptions = z.output<typeof fileExplorationOptionsSchema>;

/** Parse + default caller options, throwing a zod error on an invalid shape. */
export function resolveOptions(
  options: FileExplorationOptions,
): ResolvedFileExplorationOptions {
  return fileExplorationOptionsSchema.parse(options);
}
