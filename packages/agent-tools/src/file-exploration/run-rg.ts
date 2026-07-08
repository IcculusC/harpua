import { execFile } from "node:child_process";

/** Result of running ripgrep: captured streams plus the process exit code. */
export interface RgResult {
  stdout: string;
  stderr: string;
  /** ripgrep exit code: 0 = matches/ok, 1 = no matches, >=2 = real error. */
  code: number;
}

/**
 * Runs ripgrep with an explicit ARGUMENT ARRAY — never a shell string — so a
 * user-supplied pattern or glob cannot inject a command (there is no shell to
 * interpret metacharacters). Resolves with the exit code instead of rejecting
 * on a non-zero exit, so callers can distinguish "no matches" (1) from a real
 * failure (>=2). A missing `rg` binary surfaces as an `ENOENT` rejection for
 * callers to translate into an install hint.
 *
 * Kept in its own tiny module so tests can spy on it and exercise the
 * formatting/capping logic on machines without ripgrep installed.
 */
export function runRg(args: string[], cwd: string): Promise<RgResult> {
  return new Promise<RgResult>((resolve, reject) => {
    execFile(
      "rg",
      args,
      { cwd, maxBuffer: 32 * 1024 * 1024 },
      (error, stdout, stderr) => {
        if (error) {
          const code = (error as NodeJS.ErrnoException).code;
          // Spawn failure (binary missing): let the caller show an install hint.
          if (code === "ENOENT") {
            reject(error);
            return;
          }
          // A non-zero exit lands here with `code` set to the numeric status.
          resolve({
            stdout,
            stderr,
            code: typeof code === "number" ? code : 2,
          });
          return;
        }
        resolve({ stdout, stderr, code: 0 });
      },
    );
  });
}
