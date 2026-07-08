import fs from "node:fs";
import path from "node:path";

/**
 * Thrown when a resolved path escapes the sandbox root. Tools catch it and
 * return its message as a polite refusal rather than letting it propagate.
 */
export class SandboxError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SandboxError";
  }
}

/** A validated confinement boundary: everything resolves inside {@link Sandbox.root}. */
export interface Sandbox {
  /** The realpath of the configured root directory. */
  readonly root: string;
  /**
   * Resolve a caller-supplied path against the root and confirm it stays
   * inside. Rejects `..` traversal and symlink escapes by realpathing the
   * nearest existing ancestor. Returns the real absolute path, or throws
   * {@link SandboxError} naming the root.
   */
  resolve(input: string): string;
}

/** Realpath the deepest existing ancestor of `target`, re-appending the rest. */
function realpathNearestExisting(target: string): string {
  let current = target;
  const trailing: string[] = [];
  // Walk up until an existing path is found; realpath collapses symlinks there.
  for (;;) {
    try {
      const real = fs.realpathSync(current);
      return trailing.length ? path.join(real, ...trailing) : real;
    } catch {
      const parent = path.dirname(current);
      if (parent === current) {
        // Reached the filesystem root without finding anything that exists.
        return target;
      }
      trailing.unshift(path.basename(current));
      current = parent;
    }
  }
}

/** Segment-wise prefix check so "/rootx" is NOT considered inside "/root". */
function isWithin(root: string, candidate: string): boolean {
  if (candidate === root) return true;
  const rootSegs = root.split(path.sep);
  const candSegs = candidate.split(path.sep);
  if (candSegs.length < rootSegs.length) return false;
  for (let i = 0; i < rootSegs.length; i++) {
    if (rootSegs[i] !== candSegs[i]) return false;
  }
  return true;
}

/**
 * Build a sandbox rooted at `rawRoot`. Validates at construction that the root
 * exists and is a directory, then stores its realpath as the boundary.
 */
export function createSandbox(rawRoot: string): Sandbox {
  let stat: fs.Stats;
  try {
    stat = fs.statSync(rawRoot);
  } catch {
    throw new Error(`file-exploration root does not exist: ${rawRoot}`);
  }
  if (!stat.isDirectory()) {
    throw new Error(`file-exploration root is not a directory: ${rawRoot}`);
  }
  const root = fs.realpathSync(rawRoot);

  return {
    root,
    resolve(input: string): string {
      const target = path.resolve(root, input);
      const real = realpathNearestExisting(target);
      if (!isWithin(root, real)) {
        throw new SandboxError(
          `Refused: "${input}" resolves outside the sandbox root (${root}). ` +
            `Paths must stay within the project root.`,
        );
      }
      return real;
    },
  };
}
