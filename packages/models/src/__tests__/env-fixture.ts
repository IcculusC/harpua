/**
 * Deterministic, offline env fixture. Stubs `process.env` for the duration of a
 * test with EXACTLY the provided keys (a clean slate — the ambient environment
 * is not inherited, so a stray `OPENROUTER_API_KEY` on the dev machine can never
 * leak into a test). Call the returned `restore()` in `afterEach`.
 */
export function stubEnv(vars: Record<string, string> = {}): {
  env: NodeJS.ProcessEnv;
  restore: () => void;
} {
  const original = process.env;
  const env: NodeJS.ProcessEnv = { ...vars };
  process.env = env;
  return {
    env,
    restore: () => {
      process.env = original;
    },
  };
}
